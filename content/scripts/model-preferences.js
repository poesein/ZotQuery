/* Model/API/template configuration belongs to preferences, never the workbench. */
(function () {
  "use strict";
  const visionBindings = new WeakMap();
  async function bind(win) {
    const doc = win.document, $ = id => doc.getElementById(id);
    const root = $("zotquery-group-output-model");
    if (!root) return;
    if (root.dataset.bound) { bindVision(win, "model-vision", "model-vision-state"); return; }
    root.dataset.bound = "1";
    const api = Zotero.ZotQueryModelAgent;
    const status = (message, bad = false) => {
      $("model-settings-status").textContent = message;
      $("model-settings-status").dataset.state = bad ? "bad" : "ok";
    };
    if (!api) { status("输出模型未启动，请重新启动 Zotero 后重试。", true); return; }
    function form() {
      return { ...api.getConfig(), provider: $("model-provider").value,
        baseURL: $("model-base-url").value.trim(), model: $("model-name").value.trim(),
        reasoningEffort: $("model-reasoning").value,
        visionEnabled: $("model-vision")?.checked === true,
        maxTokensMode: $("model-budget-mode")?.value || "manual",
        maxTokens: Number($("model-max-tokens").value),
        maxSteps: Number($("model-max-steps").value), timeoutSeconds: Number($("model-timeout").value) };
    }
    function render(config) {
      $("model-state").textContent = `${config.providerLabel} · ${config.model} · ${!config.apiKeyRequired || config.apiKeyConfigured ? "凭据已就绪" : "尚未保存 API Key"}`;
    }
    $("model-check-limits")?.addEventListener("click", event => action(event.currentTarget, async () => {
      status("正在读取模型目录，不发送研究内容、不生成回答…");
      const limits = await api.inspectLimits(form(), $("model-api-key").value);
      status(`服务商输出上限：${limits.output ?? "未公布 / 未能读取"}；共享上下文容量：${limits.context ?? "未公布 / 不适用"}。未公布不代表无限；自动模式将有限度自适应。`);
    }));
    async function templateState() {
      const info = await api.templateInfo();
      $("template-state").textContent = info.configured ? `${info.name} · ${info.characters} 字符\n${info.path}` : (info.error || "未使用模板，可直接生成大模型回答。");
    }
    async function action(button, task) {
      if (button.disabled) return;
      button.disabled = true;
      try { await task(); } catch (error) { status(error?.message || String(error), true); }
      finally { button.disabled = false; }
    }
    $("model-save").addEventListener("click", event => action(event.currentTarget, async () => {
      status("正在保存配置…");
      const config = await api.saveConfig(form(), { apiKey: $("model-api-key").value });
      $("model-api-key").value = ""; render(config);
      status("配置已保存；研究台下次研究自动使用。API Key 由 Zotero 登录管理器保存。");
    }));
    $("model-test").addEventListener("click", event => action(event.currentTarget, async () => {
      status("正在测试连接与两轮工具回传（不读取文献，产生少量 API 用量）…");
      const result = await api.testConnection(form(), $("model-api-key").value);
      status(`连接成功：${result.provider}/${result.model} 返回 ${result.reply}。测试不会保存配置，请点击保存。`);
    }));
    $("model-provider").addEventListener("change", event => {
      const option = event.currentTarget.selectedOptions[0];
      if (option) { $("model-base-url").value = option.dataset.baseUrl; $("model-name").value = option.dataset.model; }
    });
    $("choose-template").addEventListener("click", event => action(event.currentTarget, async () => {
      const { FilePicker } = ChromeUtils.importESModule("chrome://zotero/content/modules/filePicker.mjs");
      const picker = new FilePicker(); picker.init(win, "选择输出 Markdown 模板", picker.modeOpen); picker.appendFilter("Markdown", "*.md");
      if (await picker.show() !== picker.returnOK) return;
      const file = picker.file, path = typeof file === "string" ? file : file?.path;
      if (typeof path !== "string" || !path.trim()) throw new Error("文件选择器未返回有效路径，请重新选择文件");
      await api.setTemplatePath(path); await templateState();
      status("模板选择已保存；生成时会把 .md 全文交给模型作为输出格式参考。");
    }));
    $("reset-template").addEventListener("click", event => action(event.currentTarget, async () => {
      await api.resetTemplate(); await templateState(); status("已清除模板选择，原文件保留；可直接生成回答。");
    }));
    const select = $("model-provider"); select.replaceChildren();
    for (const provider of api.providers()) {
      const option = doc.createElementNS("http://www.w3.org/1999/xhtml", "option");
      option.value = provider.id; option.textContent = provider.label;
      option.dataset.baseUrl = provider.defaultBaseURL; option.dataset.model = provider.defaultModel; select.append(option);
    }
    const config = api.getConfig(); select.value = config.provider;
    $("model-base-url").value = config.baseURL; $("model-name").value = config.model;
    $("model-reasoning").value = config.reasoningEffort || "auto";
    bindVision(win, "model-vision", "model-vision-state");
    $("model-max-steps").value = config.maxSteps; $("model-timeout").value = config.timeoutSeconds;
    $("model-max-tokens").value = config.maxTokens;
    if ($("model-budget-mode")) $("model-budget-mode").value = config.maxTokensMode || "manual";
    render(config);
    try { await templateState(); } catch (error) { status(error?.message || String(error), true); }
  }
  // Both views bind to one saved preference, not separate stale form copies.
  function bindVision(win, inputId, statusId) {
    const input = win.document.getElementById(inputId), status = win.document.getElementById(statusId);
    if (!input || input.dataset.visionBound) return;
    input.dataset.visionBound = "1";
    const key = "zotquery.modelAgent.visionEnabled";
    const sync = () => {
      input.checked = Zotero.ZotQueryModelAgent.getConfig().visionEnabled === true;
      if (status) status.textContent = (input.checked ? "已开启" : "已关闭 · 仅读取文字") + " · 即时保存，与设置和研究台同步";
    };
    const change = () => {
      try { Zotero.Prefs.set(key, input.checked === true, true); sync(); }
      catch (_) { sync(); if (status) status.textContent = "图片权限保存失败，请重试。"; }
    };
    const observer = { observe: sync };
    const prefs = typeof Services !== "undefined" ? Services.prefs : null;
    prefs?.addObserver(key, observer);
    input.addEventListener("change", change);
    let disposed = false;
    const cleanup = () => { if (disposed) return; disposed = true; prefs?.removeObserver(key, observer); input.removeEventListener?.("change", change); win.removeEventListener?.("focus", sync); delete input.dataset.visionBound; visionBindings.delete(win); };
    visionBindings.set(win, cleanup);
    win.addEventListener?.("focus", sync);
    win.addEventListener?.("unload", cleanup, { once: true });
    sync();
  }
  Zotero.ZotQueryModelPreferences = { bind, bindVision, unbindVision: win => visionBindings.get(win)?.() };
})();
