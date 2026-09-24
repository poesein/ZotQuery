# Build ZotQuery from source

This source tree is for **3.1.9 (local candidate)**. Source/package checks do not establish native Zotero or live provider acceptance. The ONNX model is stored through Git LFS. Clone with Git LFS installed, then run:

```powershell
git lfs pull
node --test tests/*.test.mjs tests/regression-final.mjs
node scripts/privacy-scan.mjs .
pwsh -File scripts/build-xpi.ps1
```

The script requires Node.js and `7z` on `PATH`, runs the privacy scan, verifies the bundled model SHA256, packages a fixed allowlist of plugin files and licenses, tests the archive, and writes `dist/ZotQuery-3.1.9-source-candidate.xpi` with its SHA256. It refuses to overwrite an existing output. No Zotero profile, database, token, log, or personal preference is copied. A rebuild is not necessarily byte-for-byte identical to a published XPI. This candidate has not been published: `updates.json` intentionally still describes the last public release, not an unavailable 3.1.9 URL. All README files remain unchanged; current changes and limits are in the release note.

Building an XPI does **not** prove that it starts or upgrades correctly in Zotero. Before claiming complete live acceptance, complete the remaining [deployment checklist](DEPLOY-3.0-ZH.md) and [release audit](RELEASE-AUDIT-ZH.md), including two-host switching, fresh-profile checks, and provenance review for bundled WASM/runtime files. The source's root MIT license and third-party notices do not waive those checks.
