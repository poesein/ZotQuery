/* Request lifecycle for model APIs. Never execute or persist partial output. */
(function (global) {
  "use strict";
  const failure = (code, message) => Object.assign(new Error(message), { code });
  // Transport/memory protection, NOT model token limits. Count actual UTF-8
  // bytes incrementally without creating a second full encoded buffer.
  const REQUEST_BYTES = 32 * 1024 * 1024, RESPONSE_BYTES = 128 * 1024 * 1024;
  function utf8Bytes(value) {
    let bytes=0;
    for(let i=0;i<value.length;i++) {
      const c=value.charCodeAt(i);
      if(c<128)bytes++;else if(c<2048)bytes+=2;
      else if(c>=0xd800&&c<=0xdbff&&value.charCodeAt(i+1)>=0xdc00&&value.charCodeAt(i+1)<=0xdfff){bytes+=4;i++;}
      else bytes+=3;
    }
    return bytes;
  }
  function checkSize(bytes, limit, code) {
    if(bytes>limit)throw Object.assign(failure(code,code==="REQUEST_TOO_LARGE"
      ? "请求内容超过传输保护阈值，尚未发送；需整理上下文或减小单次图片/原文分页，会话保留"
      : "响应体超过内存保护阈值，已停止接收；未执行不完整工具、未保存截断答案，会话保留"),{payloadBytes:bytes});
  }
  function contentText(value) {
    if (value == null) return "";
    if (typeof value === "string") return value;
    if (Array.isArray(value) && value.every(p => p && ["text", "output_text"].includes(p.type) && typeof p.text === "string")) return value.map(p => p.text).join("");
    throw failure("UNSUPPORTED_RESPONSE", "服务商返回了不支持的正文结构；未将对象或思考内容当作答案");
  }
  function createControl() {
    const listeners = new Set(); let cancelled = false;
    return {
      get cancelled() { return cancelled; },
      cancel() { if (cancelled) return; cancelled = true; for (const fn of [...listeners]) fn(); },
      subscribe(fn) { listeners.add(fn); if (cancelled) fn(); return () => listeners.delete(fn); },
    };
  }
  function streamParser() {
    let pending = "", done = false, finish = null, text = "", thinking = "", hasThinking = false, usage, frames = 0, refusal = "";
    const calls = new Map();
    function frame(value) {
      const data = value.split(/\r?\n/).filter(s => s.startsWith("data:")).map(s => s.slice(5).replace(/^ /, "")).join("\n");
      if (!data) return; // SSE comments/keepalives are not model progress.
      if (data === "[DONE]") { done = true; return; }
      if (done) throw failure("STREAM_INVALID", "流结束后仍收到额外数据，未采纳响应");
      let row; try { row = JSON.parse(data); } catch (_) { throw failure("STREAM_INVALID", "模型流数据格式错误，未采纳不完整响应"); }
      if (row.error) throw failure("STREAM_ERROR", "模型流返回服务端错误，未采纳不完整响应");
      if (row.usage) usage = row.usage;
      const choice = row.choices?.find(c => c.index === 0 || c.index === undefined);
      if (!choice) return;
      // Some compatible gateways wrap a complete message in one SSE frame.
      // A snapshot may extend prior deltas, but may never overwrite them.
      const snapshot = !choice.delta && !!choice.message;
      const d = choice.delta || choice.message || {};
      if (finish && (d.content || d.reasoning_content || d.reasoning || d.refusal || d.tool_calls?.length)) throw failure("STREAM_INVALID", "模型结束标记之后出现内容");
      const merge = (old, next) => {
        if (!snapshot) return old + next;
        if (!next.startsWith(old)) throw failure("STREAM_INVALID", "服务商完整消息与已接收片段冲突，未采纳响应");
        return next;
      };
      if (d.content != null) text = merge(text, contentText(d.content));
      const reason = d.reasoning_content ?? d.reasoning;
      if (reason != null) { thinking = merge(thinking, contentText(reason)); hasThinking = true; }
      if (d.refusal != null) refusal = merge(refusal, contentText(d.refusal));
      if (snapshot && d.tool_calls?.length && calls.size) throw failure("STREAM_INVALID", "工具调用同时出现片段与完整消息，无法安全合并");
      let snapshotIndex = 0;
      for (const c of d.tool_calls || []) {
        const index = snapshot ? snapshotIndex++ : c.index;
        if (!Number.isInteger(index) || index < 0) throw failure("STREAM_INVALID", "工具流缺少有效索引");
        const entry = calls.get(index) || { id: "", type: "function", function: { name: "", arguments: "" } };
        if (c.id) { if (entry.id && entry.id !== c.id) throw failure("STREAM_INVALID", "工具流标识发生变化"); entry.id = c.id; }
        if (c.function?.name) entry.function.name += c.function.name;
        if (typeof c.function?.arguments === "string") entry.function.arguments += c.function.arguments;
        calls.set(index, entry);
      }
      if (choice.finish_reason) finish = choice.finish_reason;
      frames++;
    }
    return {
      push(chunk) {
        pending += chunk;
        for (;;) {
          const boundary = /\r?\n\r?\n/.exec(pending); if (!boundary) break;
          if(boundary.index>16*1024*1024)throw failure("RESPONSE_TOO_LARGE","单个流事件过大，已停止接收；未采纳响应");
          frame(pending.slice(0, boundary.index)); pending = pending.slice(boundary.index + boundary[0].length);
        }
        if(pending.length>16*1024*1024)throw failure("RESPONSE_TOO_LARGE","单个未闭合流事件过大，已停止接收；未采纳不完整响应");
      },
      stats: () => ({ frames, contentChars: text.length, reasoningChars: thinking.length, toolCalls: calls.size }),
      result() {
        if (pending.trim()) frame(pending);
        if (!done || !finish) throw failure("STREAM_INCOMPLETE", "模型流提前断开或缺少结束标记；未执行工具、未保存截断正文，可续跑");
        const toolCalls = [...calls.entries()].sort((a,b) => a[0]-b[0]).map(([,c]) => c);
        if (!["length", "max_tokens"].includes(finish)) {
          const ids = new Set();
          for (const c of toolCalls) {
            if (!c.id || !c.function.name || ids.has(c.id)) throw failure("STREAM_INVALID", "工具流未组成完整且唯一的调用");
            ids.add(c.id);
            try { const args = JSON.parse(c.function.arguments || "{}"); if (!args || typeof args !== "object" || Array.isArray(args)) throw Error(); }
            catch (_) { throw failure("STREAM_INVALID", "工具参数流不完整或不是 JSON 对象，未执行工具"); }
          }
        }
        return { choices: [{ finish_reason: finish, message: { content: text, ...(refusal ? {refusal} : {}), ...(hasThinking ? {reasoning_content:thinking} : {}), ...(toolCalls.length ? {tool_calls:toolCalls} : {}) } }], ...(usage ? {usage} : {}) };
      },
    };
  }
  function timers() {
    if (typeof setTimeout === "function") return { setTimeout, clearTimeout };
    return ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
  }
  async function request(url, body, headers, timeoutSeconds, options = {}) {
    const timer = timers(), started = Date.now(), parser = streamParser();
    let xhr, cancelHTTP, deadline, heartbeat, unsubscribe, offset = 0, receivedChars = 0, lastDataAt = null, firstDataMs = null, stopped = false, stream = false, timerReject;
    let transportError, receivedBytes = 0;
    const listeners = [];
    const stats = () => ({ elapsedMs:Date.now()-started, receivedChars, receivedBytes, firstDataMs, idleMs:lastDataAt === null ? null : Date.now()-lastDataAt, streaming:stream, ...parser.stats() });
    const interrupt = error => {
      if (stopped || transportError) return;
      transportError = error;
      timerReject(error);
      try { if (cancelHTTP) cancelHTTP(); else xhr?.abort(); } catch (_) {}
    };
    const progress = () => { if (!stopped) { try { options.onProgress?.(stats()); } catch (_) {} } };
    const read = () => {
      if (stopped || transportError || !xhr) return;
      let value; try { value = xhr.responseText; } catch (_) { return; }
      if (typeof value !== "string" || value.length <= offset) return;
      const chunk = value.slice(offset); offset = value.length; receivedChars = offset; lastDataAt = Date.now(); firstDataMs ??= lastDataAt-started;
      receivedBytes += utf8Bytes(chunk);
      try { checkSize(receivedBytes,RESPONSE_BYTES,"RESPONSE_TOO_LARGE"); } catch(error) { interrupt(error); return; }
      const wasStream=stream;
      if (!stream) stream = /text\/event-stream/i.test(xhr.getResponseHeader?.("Content-Type") || "") || /^\s*(?:data:|event:|:)/.test(value);
      // A 4xx/5xx payload is handled as an HTTP error, never as model output.
      if (stream && (!xhr.status || xhr.status < 400)) {
        try { parser.push(wasStream ? chunk : value); } catch (error) { interrupt(error); }
      }
      progress();
    };
    const guard = new Promise((_,reject) => { timerReject = reject; });
    guard.catch(() => {}); // Cancellation may arrive before HTTP dispatch.
    const listen = (name, fn) => { xhr.addEventListener?.(name, fn); listeners.push([name,fn]); };
    try {
      if (options.control?.cancelled) throw failure("CANCELLED", "已停止模型请求；完整响应和研究证据保留，可续跑");
      deadline = timer.setTimeout(() => interrupt(failure("REQUEST_TIMEOUT", `模型请求达到总等待上限 ${timeoutSeconds} 秒，连接已停止；未自动重发`)), timeoutSeconds*1000);
      const tick = () => { progress(); if (!stopped) heartbeat = timer.setTimeout(tick, 1000); };
      heartbeat = timer.setTimeout(tick, 1000);
      unsubscribe = options.control?.subscribe(() => interrupt(failure("CANCELLED", "已停止模型请求；本次不完整响应不作为答案，可续跑")));
      if (transportError) throw transportError;
      const requestBody = options.stream ? {...body,stream:true,stream_options:{include_usage:true}} : body;
      const serialized = requestBody ? JSON.stringify(requestBody) : null;
      if(serialized)checkSize(utf8Bytes(serialized),REQUEST_BYTES,"REQUEST_TOO_LARGE");
      const operation = Zotero.HTTP.request(options.method || "POST", url, {
        ...(serialized ? {body:serialized} : {}), headers:{"Content-Type":"application/json",...headers},
        responseType:"text", timeout:timeoutSeconds*1000, logBodyLength:0, debug:false,
        // Return all statuses to THIS layer: no Zotero retry/backoff/Retry-After.
        successCodes:false, errorDelayMax:0, noRetryOnThrottle:true,
        requestObserver: value => { xhr=value; listen("progress",read); listen("readystatechange",read); if (transportError) { try {xhr.abort();} catch (_) {} } },
        cancellerReceiver: cancel => { cancelHTTP=cancel; if (transportError) cancel(); },
      });
      const completed = await Promise.race([operation,guard]);
      if (transportError) throw transportError;
      xhr = completed; read();
      if (transportError) throw transportError;
      if (xhr.status && (xhr.status < 200 || xhr.status >= 300)) throw Object.assign(new Error(`HTTP ${xhr.status}`), {status:xhr.status,xmlhttp:xhr});
      let data;
      if (stream) data=parser.result();
      else {
        if (xhr.response && typeof xhr.response === "object") { checkSize(utf8Bytes(JSON.stringify(xhr.response)),RESPONSE_BYTES,"RESPONSE_TOO_LARGE"); data=xhr.response; }
        else { try { data=JSON.parse(xhr.responseText || xhr.response || ""); } catch (_) { throw failure("INVALID_RESPONSE","服务商未返回有效 JSON 或完整事件流"); } }
        if (data?.error) throw failure("PROVIDER_REJECTED","服务商返回错误响应，未采纳为回答");
      }
      progress();
      return data;
    } catch (error) {
      const e=transportError || error; e.elapsedMs=Date.now()-started; e.transport=stats(); throw e;
    } finally {
      stopped=true; timer.clearTimeout(deadline); timer.clearTimeout(heartbeat); unsubscribe?.();
      for (const [name,fn] of listeners) { try {xhr?.removeEventListener?.(name,fn);} catch (_) {} }
    }
  }
  Zotero.ZotQueryModelTransport={request,createControl,_streamParser:streamParser,_utf8Bytes:utf8Bytes,_checkSize:checkSize};
})(typeof _globalThis !== "undefined" ? _globalThis : this);
