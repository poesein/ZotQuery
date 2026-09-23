/* Model/API/template configuration belongs to preferences, never the workbench. */
(function () {
  "use strict";
  async function bind(win) {
    const doc = win.document, $ = id => doc.getElementById(id);
    const root = $("zotquery-group-output-model");
    if (!root || root.dataset.bound) return;
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
        maxSteps: Number($("model-max-steps").value), timeoutSeconds: Number($("model-timeout").value) };
    }
    function render(config) {
      $("model-state").textContent = `${config.providerLabel} · ${config.model} · ${!config.apiKeyRequired || config.apiKeyConfigured ? "凭据已就绪" : "尚未保存 API Key"}`;
    }
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
      status("配置已保存；工作台下次研究自动使用。API Key 由 Zotero 登录管理器保存。");
    }));
    $("model-test").addEventListener("click", event => action(event.currentTarget, async () => {
      status("正在测试连接…");
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
    $("model-max-steps").value = config.maxSteps; $("model-timeout").value = config.timeoutSeconds;
    render(config);
    try { await templateState(); } catch (error) { status(error?.message || String(error), true); }
  }
  Zotero.ZotQueryModelPreferences = { bind };
})();
