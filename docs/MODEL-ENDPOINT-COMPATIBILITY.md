# Model endpoint switching (3.0.14)

ZotQuery keeps PDF chunks and Note segment vectors under one indexed model ID. A server address is a transport choice, not proof that the embedding model changed. To prevent an address change from showing an empty index, selecting another registered server model now attempts a guarded cache-identity adoption.

Reuse is permitted only when the existing model has indexed content, the selected registration has no PDF index, and both registrations agree on dimension, query/document prefixes, pooling, normalization, Ollama model digest, and two fixed embedding probes (cosine at least 0.999). The probes contain no user text. On success, the new endpoint replaces the old endpoint in the existing registration while its indexed ID stays unchanged. PDF and Note databases are neither copied nor rewritten. The old candidate registration is removed, but no vectors are deleted.

The active server's digest and fixed probes are saved after a successful connection. This allows a later move away from an unavailable old host only when its previously verified fingerprint is available. OpenAI-compatible servers that do not expose a verifiable Ollama `/api/tags` digest retain separate endpoint IDs. A changed digest, incompatible preprocessing, unexpected dimensions, or divergent probes cannot reuse the cache. The UI reports that verification failed; the old database rows remain available when switching back.

The first endpoint-scoped ID may still contain its historical address after a successful move. That string is now an immutable cache key, not a routing instruction: requests use the selected registration's current `baseUrl`. If adding a new registration would collide with that historical ID, ZotQuery gives it a temporary candidate ID so verification occurs before changing the active connection.

A failed connection while switching restores the prior active model. Re-registering a model whose tag and address are unchanged but whose previously verified fingerprint may have changed also creates a candidate registration; it cannot overwrite the fingerprint attached to an indexed identity.

This rule applies only to ZotQuery's own index. It does not reopen shared writable state with ZotSeek. A genuinely different model still requires new vectors. Index counts and live query readiness are separate checks; an offline server must not erase indexed content.
