# ZotQuery

Dual-source PDF and Note retrieval, evidence review, and traceable research workflows inside Zotero 10.

[简体中文](README.md) · [Download the 3.0.14 XPI](https://github.com/poesein/ZotQuery/releases/tag/v3.0.14) · [Architecture notes (Chinese)](docs/ARCHITECTURE-3.0-ZH.md) · [Report an issue](https://github.com/poesein/ZotQuery/issues)

ZotQuery does not treat a search hit as a verified answer. It helps researchers find leads in their Zotero library and reading notes, return to locatable PDF passages, record reviews and facts, and see which evidence is still missing. It runs inside Zotero and also exposes authenticated local MCP tools to external AI clients.

Version **3.0.14** supports Zotero 10.0.x. One existing Zotero profile passed installed-version, preserved-index, live embedding, and authenticated MCP search checks. Fresh-profile installation, migration from the old extension ID, and switching between two live model hosts have not received end-to-end acceptance testing. Back up your data and try it in a recoverable environment first.

## Why use ZotQuery?

- **PDFs and notes play different roles.** PDF search locates original text; Note search recovers organized observations and reading trails. A Note hit is a lead, not automatically primary-source evidence.
- **The search scope is explicit.** A Query Contract separates required, optional, excluded, and caller-declared alias terms. Coverage is measured against that contract and the indexed corpus—not claimed for every paper in existence.
- **Review is auditable.** Candidate positions, context access, review decisions, typed fact values, source quotes, and unresolved conflicts have separate persisted states.
- **Research can resume.** Survey keeps multi-angle queries, deduplicated candidate works, screening decisions, and reading progress across Zotero restarts.
- **One embedding runtime serves both paths.** PDF and Note indexes remain separate, but use the same active model. An Ollama endpoint move may reuse vectors only after guarded equivalence checks; a genuinely different model is not silently mixed in.
- **Humans and AI clients can share the workflow.** Zotero provides local UI, while `zotquery_*` MCP tools let a client inspect and update the research ledger. Output profiles change presentation without weakening evidence gates.

The added value over a tool that only returns top-ranked passages is the distinction between **retrieved** and **read and reviewed**. ZotQuery does not claim benchmark superiority over other plugins or replace scientific judgment.

## Architecture at a glance

Core, Search, Survey, Evidence, Agent, and MCP are responsibilities **inside one Zotero plugin**, not six separate services or models. Version 3.0.14 uses three databases: `zotquery.sqlite`, `zotquery-lne.sqlite`, and `zotquery-research.sqlite`. The embedding service may also run on a trusted private IPv4 LAN, not only on loopback. See the [architecture notes (Chinese)](docs/ARCHITECTURE-3.0-ZH.md) for details.

| Path or module | Responsibility | Important limit |
| --- | --- | --- |
| Search (PDF) | Extract and chunk indexed PDFs, run lexical/semantic retrieval, retain page and passage positions where available | Cannot promise complete text from scans, truncated extraction, or unindexed attachments |
| Core (Note) | Canonicalize and segment notes, apply configured evidence-role labels, index text and vectors, retain canonical line references | A Note label does not prove the corresponding original-paper claim |
| Survey and Evidence | Organize candidates, read context, record reviews and FactRecords, inspect coverage and conflicts | Co-occurring terms and similarity scores are not facts |
| Agent, output, and MCP | Orchestrate steps, present persisted results, and expose tools to external clients | Not a built-in generative agent that independently writes and validates a research answer |

The shared **embedding model converts text into retrieval vectors**. Bundled Nomic/ONNX or a configured embedding server is not a chat model. Any generative model used to synthesize an answer belongs to the calling client, not to ZotQuery's indexing requirement.

## Install and get started

| Item | Requirement or default |
| --- | --- |
| Zotero | 10.0.x; install the XPI through Zotero's add-on manager |
| Embeddings | Bundled Nomic ONNX model or a reachable compatible embedding service; Qwen or another generative model is not required for indexing |
| PDF scope | Title and abstract by default; select full PDF and inspect extraction/coverage for original-passage research |
| Note scope | My Library by default; automatic change sync is off until enabled, with manual sync available |
| Network | Local inference can stay on the machine; a LAN server receives the text—and possibly credentials—sent to it |

1. Back up the Zotero data directory. Download the XPI from the [3.0.14 release](https://github.com/poesein/ZotQuery/releases/tag/v3.0.14), install it from a file in Zotero's add-on manager, and restart. Version 3.0.14 upgrades the isolated-ID 3.0.12/3.0.13 line, but cannot automatically upgrade or migrate earlier builds that used ZotSeek's extension ID. A same-version asset refresh does not trigger auto-update; existing 3.0.14 installations must reinstall the XPI manually to receive the refreshed package.
2. In ZotQuery settings, choose the PDF and Note scopes and one active embedding model. Start with a small mixed sample. If using LAN Ollama, verify connectivity from the Zotero machine; public Internet inference hosts are not supported.
3. Index PDFs and sync Notes. Inspect PDF coverage, Note-vector coverage, shared-model agreement, and **query-time model readiness** separately. A complete cache does not mean a stopped server can answer a new dense query.
4. Explore with search, or let an MCP-capable client follow the research workflow below. For primary evidence, open PDF context rather than quoting a search preview or a Note alone.

The built-in `generic` Note Profile handles ordinary notes; `strawberry-vnext` is compatibility with one reading-note **format**, not a research-topic preset. Output Profiles (`compact`, `standard`, `exact`, `exhaustive-vnext`) change presentation, not evidence rules. See [Profiles](docs/PROFILES-3.0-ZH.md).

## A traceable research workflow

1. Run `zotquery_evidence_plan` to inspect required/optional terms, aliases, and estimated scope. Review automatically planned hard constraints before treating them as the study boundary.
2. Start `zotquery_evidence_research_start` to combine PDF Evidence and persistent Survey, or `zotquery_evidence_sweep` for a PDF-only coverage session.
3. Page through `zotquery_evidence_positions`; open required context with `zotquery_evidence_context`, then record `zotquery_evidence_review`. Note leads can be checked against PDFs attached to the same Zotero parent item.
4. For exact facts, record `zotquery_evidence_fact` from reviewed original PDF passages, retaining value, unit, numbering, quote, and locator. Conflicts require a separate source-backed resolution.
5. Inspect `zotquery_evidence_finalize` and the persisted research result. Missing scope, reading, fact slots, or conflict decisions keep a session staged. Passing the gate means **ready for synthesis**, not that a final interpretation has been automatically proven.

These steps often repeat and page through many positions; one call per tool is not a completion test. See the [research protocol](docs/RESEARCH-PROTOCOL-ZH.md) and [Query Contract guide](docs/QUERY-CONTRACT-V2-ZH.md).

## Local MCP, storage, and privacy

The unified `/zotquery/mcp` endpoint exposes **43 `zotquery_*` tools**, some of which write local research state. Clients must send the `Authorization: Bearer <token>` header using the token obtained in settings. Do not proxy the Zotero Local API port to a LAN or public network. The default port is commonly `23119`; use your Zotero configuration as the authority.

The three SQLite files above keep PDF indexes, Note/Survey state, and Evidence sessions separate. The public XPI contains no personal library, PDF, Note, database, personal preference, inference-server address, or credential. A configured LAN embedding service receives the text sent to it; with plain HTTP, that text and any credentials are unencrypted on the LAN. Whether an external AI client later sends retrieved material to a cloud model depends on that client's settings. **Local plugin storage does not imply an entirely offline research workflow.**

## Limits, attribution, and development

- The Coverage Gate audits **indexed candidates matching the declared query contract**, not all literature. PDF truncation, OCR gaps, and terms in different chunks can cause misses.
- A DIRECT FactRecord checks a reviewed PDF position and a literal value in the bound quote; it cannot automatically judge negation, assay conditions, units, or scientific interpretation.
- A PDF page link is made only when the attachment is unambiguous and the physical page is valid. Note links are item-level, with canonical lines and quotes as references.
- Survey persists progress, Agent orchestrates steps, and MCP provides access. None can force an external model to obey evidence rules.

ZotQuery adapts the PDF retrieval and embedding runtime of [ZotSeek](https://github.com/introfini/ZotSeek) 1.21.2, adding the native Note path, Survey, Evidence, guarded output, and unified MCP. Project contributions use the root [MIT license](LICENSE); third-party attribution and unresolved provenance details are in the [notice](THIRD-PARTY-NOTICE.md). See [Building](docs/BUILDING.md) for source checks. When reporting issues, share versions, reproduction steps, and **redacted** logs—never a full Zotero profile or database.

The [release audit](docs/RELEASE-AUDIT-ZH.md) records completed checks and outstanding acceptance work.
