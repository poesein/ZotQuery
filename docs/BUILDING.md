# Build ZotQuery from source

This source tree is for **3.0.14**. One Zotero 10 profile passed installed-version, existing-index, live embedding, and authenticated MCP checks; a switch between two live inference hosts remains untested. The ONNX model is stored through Git LFS. Clone with Git LFS installed, then run:

```powershell
git lfs pull
node tests/regression-final.mjs
pwsh -File scripts/build-xpi.ps1
```

The script requires `7z` on `PATH`, verifies the bundled model against the official Nomic ONNX SHA256, packages only a fixed allowlist of plugin files (including all bundled license texts), tests the archive, and writes `dist/ZotQuery-3.0.14.xpi` with its SHA256. It refuses to overwrite an existing output. No Zotero profile, database, token, log, or personal preference is copied. A rebuild from a later documentation commit may not be byte-for-byte identical to the published 3.0.14 XPI; the update feed records the published asset hash.

Building an XPI does **not** prove that it starts or upgrades correctly in Zotero. Before claiming complete live acceptance, complete the remaining [deployment checklist](DEPLOY-3.0-ZH.md) and [release audit](RELEASE-AUDIT-ZH.md), including two-host switching, fresh-profile checks, and provenance review for bundled WASM/runtime files. The source's root MIT license and third-party notices do not waive those checks.
