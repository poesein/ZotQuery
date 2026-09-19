/** ZotQuery-LNE Research 3.0.13 bootstrap. */

var chromeHandle;

function install(data, reason) {}

async function startup({ id, version, resourceURI, rootURI }, reason) {
  Zotero.debug("[ZotQuery Bootstrap] Waiting for initialization...");
  await Zotero.initializationPromise;
  Zotero.debug("[ZotQuery Bootstrap] Zotero initialized");

  // Register chrome content and locale
  Zotero.debug("[ZotQuery Bootstrap] Registering chrome content...");
  var aomStartup = Components.classes[
    "@mozilla.org/addons/addon-manager-startup;1"
  ].getService(Components.interfaces.amIAddonManagerStartup);
  var manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = aomStartup.registerChrome(manifestURI, [
    ["content", "zotquery", rootURI + "content/"],
    ["locale", "zotquery", "en-US", rootURI + "locale/en-US/"],
    ["locale", "zotquery", "zh-CN", rootURI + "locale/zh-CN/"],
  ]);
  Zotero.debug("[ZotQuery Bootstrap] Chrome content and locale registered");

  // Create context for the plugin script
  // _globalThis allows the script to access this context
  const ctx = {
    rootURI,
    Zotero,
    // Provide document for fake browser environment
    document: Zotero.getMainWindow()?.document,
  };
  ctx._globalThis = ctx;

  // Load the main script
  Zotero.debug("[ZotQuery Bootstrap] Loading main script...");
  try {
    Services.scriptloader.loadSubScript(
      `${rootURI}content/scripts/index.js`,
      ctx
    );
    Zotero.debug("[ZotQuery Bootstrap] Main script loaded");
  } catch (e) {
    Zotero.debug("[ZotQuery Bootstrap] ERROR loading script: " + e);
    Zotero.logError(e);
    return;
  }

  // The script attaches itself to Zotero.ZotQuery
  if (Zotero.ZotQuery) {
    Zotero.debug("[ZotQuery Bootstrap] Calling onStartup...");
    Zotero.ZotQuery.setInfo({ id, version, rootURI });
    await Zotero.ZotQuery.hooks.onStartup();
    Zotero.debug("[ZotQuery Bootstrap] Loading LNE Native...");
    try {
      Services.scriptloader.loadSubScript(`${rootURI}content/scripts/note-profiles.js`, ctx);
      await ctx.ZotQueryNoteProfilesBootstrap?.startup?.({ rootURI });
      Services.scriptloader.loadSubScript(`${rootURI}content/scripts/lne-native.js`, ctx);
      await ctx.ZotQueryLNEBootstrap?.startup?.({ rootURI });
      Services.scriptloader.loadSubScript(`${rootURI}content/scripts/lne-tools.js`, ctx);
      await ctx.ZotQueryLNEToolsBootstrap?.startup?.();
      Zotero.debug("[ZotQuery Bootstrap] LNE Native + full tools started");
    } catch (e) {
      (Zotero.ZotQueryStartupErrors ||= {}).lne = e?.message || String(e);
      Zotero.debug("[ZotQuery Bootstrap] LNE Native startup error: " + e);
      Zotero.logError(e);
    }

    Zotero.debug("[ZotQuery Bootstrap] Loading Research Engine...");
    try {
      Services.scriptloader.loadSubScript(`${rootURI}content/scripts/output-profiles.js`, ctx);
      await ctx.ZotQueryOutputProfilesBootstrap?.startup?.({ rootURI });
      Services.scriptloader.loadSubScript(`${rootURI}content/scripts/research-engine.js`, ctx);
      await ctx.ZotQueryResearchBootstrap?.startup?.();
      Zotero.debug("[ZotQuery Bootstrap] Research Engine started");
    } catch (e) {
      (Zotero.ZotQueryStartupErrors ||= {}).research = e?.message || String(e);
      Zotero.debug("[ZotQuery Bootstrap] Research Engine startup error: " + e);
      Zotero.logError(e);
    }
    Zotero.debug("[ZotQuery Bootstrap] Loading Research UI...");
    try {
      Services.scriptloader.loadSubScript(`${rootURI}content/scripts/research-ui.js`, ctx);
      await ctx.ZotQueryResearchUIBootstrap?.startup?.();
      Zotero.debug("[ZotQuery Bootstrap] Research UI started");
    } catch (e) {
      Zotero.debug("[ZotQuery Bootstrap] Research UI startup error: " + e);
      Zotero.logError(e);
    }
    Zotero.debug("[ZotQuery Bootstrap] Startup complete");
  } else {
    Zotero.debug("[ZotQuery Bootstrap] ERROR: Zotero.ZotQuery not found!");
  }
}

function onMainWindowLoad({ window: win }) {
  Zotero.ZotQuery?.hooks.onMainWindowLoad(win);
  Zotero.ZotQueryResearchUI?.customizeMainWindow?.(win);
}

function onMainWindowUnload({ window: win }) {
  Zotero.ZotQuery?.hooks.onMainWindowUnload(win);
}

async function shutdown({ id, version, resourceURI, rootURI }, reason) {
  if (reason === APP_SHUTDOWN) {
    return;
  }

  try { await Zotero.ZotQueryResearchUI?.shutdown?.(); } catch (e) { Zotero.logError(e); }
  try { await Zotero.ZotQueryResearch?.shutdown?.(); } catch (e) { Zotero.logError(e); }
  try { await Zotero.ZotQueryLNETools?.shutdown?.(); } catch (e) { Zotero.logError(e); }
  try { await Zotero.ZotQueryLNE?.shutdown?.(); } catch (e) { Zotero.logError(e); }
  Zotero.ZotQuery?.hooks.onShutdown();

  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }
}

// Leave indexes, surveys and preferences intact on uninstall. Users may
// reinstall or migrate the plugin without losing their research record.
async function uninstall(data, reason) {}
