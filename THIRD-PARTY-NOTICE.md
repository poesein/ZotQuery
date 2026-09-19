# Third-party notice

This distribution is a research fork/integration built from ZotSeek 1.21.2 by José Fernandes / introfini.
Upstream project: https://github.com/introfini/zotseek
The upstream README states "MIT License - see LICENSE", and the `v1.21.2` `package.json` declares `"license": "MIT"`. The upstream `v1.21.2` repository did not contain a LICENSE file when checked, so [the ZotSeek MIT notice](THIRD-PARTY-LICENSES/ZotSeek-MIT.txt) reproduces the standard [SPDX MIT text](https://spdx.org/licenses/MIT.html) with an attribution line based on the upstream author and repository dates. The repository's contributor list showed `introfini` and `wjma-phy` when checked. This is **not** a verbatim upstream LICENSE file; confirm definitive copyright ownership with upstream before describing the binary release as fully cleared.

The added `content/scripts/research-engine.js`, deployment scripts and research protocol are integration-layer additions for this build.

The bundled `content/models/Xenova/nomic-embed-text-v1.5/onnx/model_quantized.onnx` has SHA256 `b4342336debaea79de872370664b0aaeb67dea4605513d00ee236ea871a81f27`, matching the official `nomic-ai/nomic-embed-text-v1.5` ONNX file. The [model card](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5) declares Apache-2.0; the [Apache 2.0 text](THIRD-PARTY-LICENSES/Apache-2.0.txt) is included. The bundled Transformers.js runtime is also [Apache-2.0](https://github.com/huggingface/transformers.js/blob/main/LICENSE). The bundled ONNX Runtime Web assets use the [ONNX Runtime MIT license](THIRD-PARTY-LICENSES/ONNX-Runtime-MIT.txt). Further notices embedded in `content/scripts/embedding-worker.js` are retained.

The exact provenance/version of each bundled WASM and minified runtime asset has not yet been matched byte-for-byte to its upstream distribution. Public source may be staged with this disclosure, but do not describe the XPI as a fully license-audited production release until that check and the ZotSeek copyright-holder review are complete. ZotQuery's own contributions use the root [MIT LICENSE](LICENSE); this does not supersede third-party licenses.

Model: https://huggingface.co/nomic-ai/nomic-embed-text-v1.5
Runtime: https://github.com/microsoft/onnxruntime
