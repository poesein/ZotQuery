/* ZotQuery Note Profile layer: data-driven parsing without executable templates. */
(function (global) {
  "use strict";
  const ROLES = new Set(["OBSERVED_EVIDENCE", "AUTHOR_CLAIM", "AUTHOR_INTERPRETATION", "USER_INFERENCE", "EVIDENCE_QUALITY", "BACKGROUND", "LIMITATION", "UNKNOWN"]);
  const SECTION_KINDS = new Set(["conclusion", "question", "method", "limitation", "background", "figure", "reference", "project", "body"]);
  const builtins = ["generic", "strawberry-vnext"];
  const profiles = new Map();
  let rootURI = null;
  const normalize = value => String(value || "").normalize("NFKC").toLocaleLowerCase("und").trim();
  const hash = value => { let h = 0x811c9dc5; for (const ch of String(value)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, "0"); };
  const escapeRE = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  function validate(value) {
    const errors = [];
    if (!value || typeof value !== "object" || Array.isArray(value)) return { valid: false, errors: ["profile must be a JSON object"] };
    if (!/^[a-z][a-z0-9-]{1,63}$/.test(String(value.id || ""))) errors.push("id must be 2–64 lowercase letters, digits or hyphens");
    if (!String(value.name || "").trim()) errors.push("name is required");
    if (!String(value.version || "").trim()) errors.push("version is required");
    if (!/^(all|title-or-content)$/.test(String(value.selector?.mode || ""))) errors.push("selector.mode must be all or title-or-content");
    if (value.selector?.mode === "title-or-content" && (!Array.isArray(value.selector.patterns) || !value.selector.patterns.length)) errors.push("title-or-content selector requires at least one literal pattern");
    if (value.selector?.patterns !== undefined && !Array.isArray(value.selector.patterns)) errors.push("selector.patterns must be an array");
    for (const pattern of Array.isArray(value.selector?.patterns) ? value.selector.patterns : []) if (typeof pattern !== "string" || !pattern.trim() || pattern.length > 120) errors.push("selector patterns must be short literal strings");
    for (const [tag, mapping] of Object.entries(value.evidenceTags || {})) {
      if (!tag || tag.length > 80 || !ROLES.has(mapping?.role)) errors.push(`invalid evidence tag mapping: ${tag}`);
      for (const key of ["baseWeight", "evidenceWeight", "conclusionWeight"]) if (mapping?.[key] !== undefined && (!Number.isFinite(mapping[key]) || Math.abs(mapping[key]) > 2)) errors.push(`invalid ${key}: ${tag}`);
    }
    for (const [kind, terms] of Object.entries(value.sections || {})) if (!SECTION_KINDS.has(kind) || !Array.isArray(terms) || terms.some(x => typeof x !== "string" || !x.trim() || x.length > 120)) errors.push(`invalid section mapping: ${kind}`);
    if (value.title?.stripPrefixes !== undefined && !Array.isArray(value.title.stripPrefixes)) errors.push("title.stripPrefixes must be an array");
    for (const prefix of Array.isArray(value.title?.stripPrefixes) ? value.title.stripPrefixes : []) if (typeof prefix !== "string" || prefix.length > 120) errors.push("invalid title prefix");
    return { valid: errors.length === 0, errors };
  }
  function register(value, source) {
    const check = validate(value);
    if (!check.valid) throw new Error(`Invalid Note Profile: ${check.errors.join("; ")}`);
    const profile = JSON.parse(JSON.stringify(value));
    profile.source = source;
    profile.signature = hash(JSON.stringify(value));
    profiles.set(profile.id, profile);
    return profile;
  }
  async function readBundled(name) {
    const url = `${rootURI}content/profiles/notes/${name}.json`;
    // rootURI points into an XPI (jar:). Zotero's generic async URL reader
    // uses HTTP.request; getResourceAsync uses an nsIChannel for jar: URLs.
    const text = Zotero.File.getResourceAsync ? await Zotero.File.getResourceAsync(url) : Zotero.File.getResource(url);
    return JSON.parse(text);
  }
  async function reloadCustom() {
    const directory = PathUtils.join(Zotero.DataDirectory.dir, "zotquery", "profiles", "notes");
    if (!(await IOUtils.exists(directory))) return { directory, loaded: 0 };
    let loaded = 0;
    for (const path of await IOUtils.getChildren(directory)) {
      if (!/\.json$/i.test(path)) continue;
      try { const parsed = JSON.parse(await IOUtils.readUTF8(path)); if (builtins.includes(parsed.id)) throw new Error("built-in profile id is reserved"); register(parsed, "custom"); loaded++; }
      catch (e) { Zotero.debug(`[ZotQuery Note Profiles] Ignored ${path}: ${e?.message || e}`); }
    }
    return { directory, loaded };
  }
  async function startup({ rootURI: uri }) {
    rootURI = uri;
    profiles.clear();
    for (const name of builtins) register(await readBundled(name), "built-in");
    await reloadCustom();
  }
  function get(id) { return profiles.get(String(id || "")) || null; }
  function list() { return [...profiles.values()].map(p => ({ id: p.id, name: p.name, version: p.version, source: p.source, signature: p.signature, selector: p.selector })); }
  function matches(profile, title, text) {
    if (!profile) return false;
    if (profile.selector.mode === "all") return true;
    const hay = normalize(`${title || ""}\n${String(text || "").slice(0, 3000)}`);
    return (profile.selector.patterns || []).some(p => hay.includes(normalize(p)));
  }
  function choose(title, text, preferred = null) {
    if (preferred) { const p = get(preferred); if (!p) throw new Error(`Unknown Note Profile: ${preferred}`); return p; }
    for (const profile of profiles.values()) if (profile.id !== "generic" && matches(profile, title, text)) return profile;
    return get("generic");
  }
  function matchTag(text, profile) {
    for (const [rawTag, mapping] of Object.entries(profile?.evidenceTags || {})) {
      const key = escapeRE(rawTag);
      if (new RegExp(`【\\s*${key}(?:\\s*[—–-][^】]*)?\\s*】|\\[\\s*${key}\\s*\\]`, "iu").test(String(text || ""))) return { rawTag, role: mapping.role };
    }
    return null;
  }
  function roleForTag(rawTag, profile) { return profile?.evidenceTags?.[rawTag]?.role || "UNKNOWN"; }
  function sectionKind(path, profile) {
    const hay = normalize(path);
    for (const [kind, terms] of Object.entries(profile?.sections || {})) if ((terms || []).some(term => hay.includes(normalize(term)))) return kind;
    return "body";
  }
  function weightForRole(role, profile, want = {}) {
    const mapping = Object.values(profile?.evidenceTags || {}).find(x => x.role === role);
    if (!mapping) return 0;
    if (want.evidence && mapping.evidenceWeight !== undefined) return mapping.evidenceWeight;
    if (want.conclusion && mapping.conclusionWeight !== undefined) return mapping.conclusionWeight;
    return mapping.baseWeight || 0;
  }
  function titleFromText(text, profile) {
    const raw = String(text || "").match(/^#{1,6}\s+(.+?)\s*$/m)?.[1]?.trim() || "";
    for (const prefix of profile?.title?.stripPrefixes || []) if (normalize(raw).startsWith(normalize(prefix))) return raw.slice(prefix.length).trim();
    return raw;
  }
  function duplicateStyle(text, profile) {
    if (!profile?.duplicatePolicy?.enabled) return "none";
    const heading = String(text || "").match(/^#{1,6}\s+(.+?)\s*$/m)?.[1] || "";
    for (const [style, token] of Object.entries(profile.duplicatePolicy.styles || {})) if (heading.includes(token)) return style;
    return "other";
  }
  function draftFromTemplate(markdown) {
    const headings = [...String(markdown || "").matchAll(/^#{1,6}\s+(.+)$/gm)].map(m => m[1].trim());
    const tags = [...new Set([...String(markdown || "").matchAll(/【\s*([^】]{1,80})\s*】/g)].map(m => m[1].split(/[—–-]/, 1)[0].trim()))];
    return { id: "my-note-profile", name: "My Note Profile", version: "1.0.0", selector: { mode: "title-or-content", patterns: [] }, title: { stripPrefixes: [] }, evidenceTags: Object.fromEntries(tags.map(tag => [tag, { role: "UNKNOWN", baseWeight: 0 }])), sections: { body: headings }, duplicatePolicy: { enabled: false, styles: {}, preferred: null }, requiresConfirmation: true, warning: "Review every evidence role and selector before import; headings alone cannot prove evidence semantics." };
  }
  async function installCustom(value, { confirmed = false } = {}) {
    if (!confirmed) throw new Error("Confirm the selector and every evidence role before installing a Note Profile");
    if (builtins.includes(value?.id)) throw new Error("Built-in profile id is reserved");
    const check = validate(value); if (!check.valid) throw new Error(check.errors.join("; "));
    const directory = PathUtils.join(Zotero.DataDirectory.dir, "zotquery", "profiles", "notes");
    await IOUtils.makeDirectory(directory, { createAncestors: true });
    const path = PathUtils.join(directory, `${value.id}.json`);
    if (await IOUtils.exists(path)) throw new Error("Profile already exists; choose another id or remove it explicitly");
    await IOUtils.writeUTF8(path, JSON.stringify(value, null, 2));
    return register(value, "custom");
  }
  function active() { return String(Zotero.Prefs.get("zotquery.lneNative.activeNoteProfile", true) || "") || null; }
  function select(id, { confirmed = false } = {}) {
    if (!confirmed) throw new Error("Profile selection changes future Note indexing; explicit confirmation is required");
    if (id && !get(id)) throw new Error(`Unknown Note Profile: ${id}`);
    Zotero.Prefs.set("zotquery.lneNative.activeNoteProfile", id || "", true);
    return { activeProfile: id || null, autoDetect: !id, requiresRestart: true, warning: "Restart Zotero to reconcile Note segments. Existing PDF index and vector cache are preserved; notes outside the selected profile may leave the Note index." };
  }
  const api = { startup, get, list, matches, choose, matchTag, roleForTag, sectionKind, weightForRole, titleFromText, duplicateStyle, validate, draftFromTemplate, installCustom, reloadCustom, active, select };
  Zotero.ZotQueryNoteProfiles = api;
  global.ZotQueryNoteProfilesBootstrap = { startup };
})(typeof _globalThis !== "undefined" ? _globalThis : this);
