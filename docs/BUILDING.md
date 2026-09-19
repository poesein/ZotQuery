# Build the ZotQuery source candidate

This repository is a **3.0.11 source candidate**, not a validated Zotero release. The ONNX model is stored through Git LFS. Clone with Git LFS installed, then run:

```powershell
git lfs pull
node tests/regression-final.mjs
pwsh -File scripts/build-xpi.ps1
```

The script requires `7z` on `PATH`, verifies the bundled model against the official Nomic ONNX SHA256, packages only a fixed allowlist of plugin files (including all bundled license texts), tests the archive, and writes `dist/ZotQuery-3.0.11-source-candidate.xpi` with its SHA256. It refuses to overwrite an existing output. No Zotero profile, database, token, log, or personal preference is copied.

Building an XPI does **not** prove that it starts or upgrades correctly in Zotero. Before publishing a GitHub Release or asking others to install it, complete the [live deployment checklist](DEPLOY-3.0-ZH.md) and [release audit](RELEASE-AUDIT-ZH.md), including provenance review for bundled WASM/runtime files. The source's root MIT license and third-party notices do not waive those checks.
