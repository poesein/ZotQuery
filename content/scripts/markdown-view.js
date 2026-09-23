/* Markdown is untrusted model output. Build allowed DOM nodes from tokens;
 * never insert model HTML, scripts, styles, images, or event attributes. */
(function () {
  "use strict";
  const NS = "http://www.w3.org/1999/xhtml";
  const entities = value => String(value || "").replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (raw, key) => {
    if (key[0] !== "#") return ({amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:"\u00a0"})[key.toLowerCase()] || raw;
    const n = key[1].toLowerCase() === "x" ? parseInt(key.slice(2),16) : Number(key.slice(1));
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "\ufffd";
  });
  function safeLink(value) {
    const url = entities(value).trim();
    if (/[\u0000-\u0020\u007f]/.test(url)) return null;
    if (/^https?:\/\//i.test(url)) {
      try { const parsed = new URL(url); return parsed.username || parsed.password ? null : parsed.href; } catch (_) { return null; }
    }
    return /^zotero:\/\/(?:select\/(?:library|groups\/\d+)\/(?:items|collections)\/[A-Z0-9]{8}|open-pdf\/(?:library|groups\/\d+)\/items\/[A-Z0-9]{8}(?:\?page=[1-9]\d*)?)$/.test(url) ? url : null;
  }
  function render(root, markdown, options = {}) {
    const doc = root.ownerDocument;
    const node = (tag, value) => { const el = doc.createElementNS(NS, tag); if(value != null) el.textContent = value; return el; };
    const plain = (parent, value, decode = true) => parent.append(doc.createTextNode(decode ? entities(value) : String(value || "")));
    function link(parent, token, image = false) {
      const href = safeLink(token.href), el = node(href ? "a" : "span");
      if (image) el.textContent = `图像：${entities(token.text || "外部图像")}（点击打开，不自动加载）`;
      else walk(el, token.tokens || [{type:"text",text:token.text}]);
      if (href) {
        el.setAttribute("href", href); el.setAttribute("rel", "noopener noreferrer");
        el.addEventListener("click", event => { event.preventDefault(); options.onLink?.(href); });
      }
      parent.append(el);
    }
    function walk(parent, tokens) {
      for (const t of tokens || []) {
        switch (t.type) {
          case "space": case "def": break;
          case "heading": { const el=node(`h${Math.max(1,Math.min(6,t.depth || 1))}`); walk(el,t.tokens); parent.append(el); break; }
          case "paragraph": case "blockquote": case "strong": case "em": case "del": {
            const el=node(t.type === "paragraph" ? "p" : t.type); walk(el,t.tokens); parent.append(el); break;
          }
          case "text": if(t.tokens) walk(parent,t.tokens); else plain(parent,t.text); break;
          case "escape": plain(parent,t.text); break;
          case "codespan": parent.append(node("code",t.text)); break;
          case "code": { const pre=node("pre"); pre.append(node("code",t.text)); parent.append(pre); break; }
          case "br": case "hr": parent.append(node(t.type)); break;
          case "link": link(parent,t); break;
          case "image": link(parent,t,true); break;
          case "list": {
            const el=node(t.ordered ? "ol" : "ul"); if(t.ordered && Number.isInteger(t.start)) el.setAttribute("start",String(t.start));
            for(const item of t.items) { const li=node("li"); if(item.task) plain(li,item.checked ? "☑ " : "☐ "); walk(li,item.tokens); el.append(li); }
            parent.append(el); break;
          }
          case "table": {
            const wrap=node("div"),table=node("table"),head=node("thead"),body=node("tbody"); wrap.className="markdown-table";
            const row=(cells,tag)=>{const tr=node("tr"); cells.forEach((cell,i)=>{const td=node(tag); if(["left","right","center"].includes(t.align[i])) td.style.textAlign=t.align[i]; walk(td,cell.tokens); tr.append(td);});return tr;};
            head.append(row(t.header,"th")); for(const cells of t.rows) body.append(row(cells,"td")); table.append(head,body); wrap.append(table); parent.append(wrap); break;
          }
          case "html": {
            // Hide provenance comments, but display arbitrary raw HTML literally.
            const visible=String(t.text || t.raw || "").replace(/<!--[\s\S]*?-->/g, "");
            if(visible) plain(parent,visible,false); break;
          }
          default: plain(parent,t.raw || t.text,false);
        }
      }
    }
    const fragment=doc.createDocumentFragment();
    try { walk(fragment, window.marked.lexer(String(markdown || ""), {gfm:true})); }
    catch (_) { const fallback=node("pre",String(markdown || "")); fragment.append(fallback); }
    root.replaceChildren(fragment);
  }
  window.ZotQueryMarkdown = { render, safeLink };
})();
