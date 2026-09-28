# ZotQuery 3.1.25 image-session and tag hotfix

This same-version local hotfix adds `zotquery_evidence_visual_session_start` for an exact Zotero `library` and `parentItemKey`. It resolves a child PDF under that parent and returns `sessionId`, `positionId`, and `attachmentKey` for `zotquery_preview_pdf_page`. The entry path does not use title search or require an indexed PDF chunk. Repeated calls for the same parent and PDF reuse the session. If a parent has multiple PDFs, the caller must specify `attachmentKey`.

The session is marked `VISUAL_ONLY`. Its anchor position does not satisfy text coverage or the synthesis gate. Page images and observations retain their normal provenance and never become text-verified direct facts automatically.

`zotquery_add_item_tag` adds an ordinary tag to an exact regular parent item. It is idempotent and never removes tags. `✅精读完成` is reserved for the existing Depth QC gated managed-note workflow.

The ChatGPT bridge exposes both actions in the compact surface. Browser ChatGPT tools must be refreshed after the tunnel bridge is replaced. This hotfix preserves the existing Note Parsing Profile, Generation Profile, research database, user notes, and 3.1.25 manifest version.
