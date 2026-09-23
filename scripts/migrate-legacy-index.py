"""Offline, opt-in ZotQuery index migration from the former ZotSeek namespace.

The legacy databases are never modified. Run without --apply first. Both
servers must expose the same Ollama model digest; matching cached note vectors
are independently checked before any write.
"""

import argparse
import base64
from contextlib import closing
import datetime as dt
import json
import math
import os
from pathlib import Path
import sqlite3
import struct
import subprocess
import urllib.request
import uuid


DB_NAMES = (
    "zotseek.sqlite",
    "zotquery.sqlite",
    "zotseek-lne.sqlite",
    "zotquery-lne.sqlite",
)


def ro(path):
    return sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)


def count(db, table, where="", args=()):
    return db.execute(f"SELECT COUNT(*) FROM {table} {where}", args).fetchone()[0]


def model_digest(server, model_name):
    url = server.rstrip("/") + "/api/tags"
    with urllib.request.urlopen(url, timeout=8) as response:
        models = json.load(response).get("models", [])
    for model in models:
        if model.get("name") == model_name:
            digest = model.get("digest")
            if not digest:
                raise RuntimeError(f"No digest for {model_name} at {server}")
            return digest
    raise RuntimeError(f"Model {model_name} is absent at {server}")


def cosine_vectors(a, b, dim_a, dim_b):
    if dim_a != dim_b or dim_a <= 0:
        raise RuntimeError("Cached vector dimensions differ")
    x = struct.unpack("<" + str(dim_a) + "f", base64.b64decode(a))
    y = struct.unpack("<" + str(dim_b) + "f", base64.b64decode(b))
    dot = sum(i * j for i, j in zip(x, y))
    norm_x = math.sqrt(sum(i * i for i in x))
    norm_y = math.sqrt(sum(i * i for i in y))
    return dot / (norm_x * norm_y)


def compare_note_vectors(target, legacy, old_id, new_id):
    with closing(ro(target)) as db:
        db.execute("ATTACH DATABASE ? AS legacy", (legacy.as_uri() + "?mode=ro",))
        rows = db.execute(
            "SELECT n.embedding, l.embedding, n.dim, l.dim "
            "FROM segment_vectors n JOIN legacy.segment_vectors l ON n.hash=l.hash "
            "WHERE n.model_id=? AND l.model_id=? ORDER BY n.hash LIMIT 200",
            (new_id, old_id),
        ).fetchall()
        if not rows:
            raise RuntimeError("No shared note vectors to verify model compatibility")
        scores = [cosine_vectors(*row) for row in rows]
        if min(scores) < 0.999:
            raise RuntimeError(f"Old/new vector outputs differ: minimum cosine {min(scores):.6f}")
        return len(rows), min(scores)


def check_zotero_closed():
    if os.name != "nt":
        return
    result = subprocess.run(
        ["tasklist", "/FI", "IMAGENAME eq zotero.exe", "/FO", "CSV"],
        capture_output=True, text=True, check=True,
    )
    if '"zotero.exe"' in result.stdout.lower():
        raise RuntimeError("Close Zotero gracefully before --apply; no live DB is overwritten")


def backup_database(source, destination):
    if destination.exists():
        raise RuntimeError(f"Refusing to overwrite {destination}")
    with closing(ro(source)) as src, closing(sqlite3.connect(destination)) as dst:
        src.backup(dst)


def verify_database(path):
    with closing(ro(path)) as db:
        result = db.execute("PRAGMA quick_check").fetchone()[0]
        if result != "ok":
            raise RuntimeError(f"SQLite quick_check failed for {path}: {result}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--old-model-id", required=True)
    parser.add_argument("--new-model-id", required=True)
    parser.add_argument("--model-name", required=True)
    parser.add_argument("--old-server", required=True)
    parser.add_argument("--new-server", required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    root = args.data_dir.resolve(strict=True)
    old_pdf, new_pdf, old_note, new_note = (root / name for name in DB_NAMES)
    for db_path in (old_pdf, new_pdf, old_note, new_note):
        if not db_path.is_file():
            raise RuntimeError(f"Missing database: {db_path}")

    old_digest = model_digest(args.old_server, args.model_name)
    new_digest = model_digest(args.new_server, args.model_name)
    if old_digest != new_digest:
        raise RuntimeError("Server model digests differ; re-embedding is required")

    with closing(ro(old_pdf)) as old, closing(ro(new_pdf)) as new:
        old_items = count(old, "items")
        old_chunks = count(old, "chunks")
        new_items = count(new, "items")
        old_model_rows = count(old, "item_models", "WHERE model_id=?", (args.old_model_id,))
        if old_items == 0 or old_model_rows != old_items:
            raise RuntimeError("Legacy PDF index does not consist solely of the specified model")
        if new_items != 0:
            raise RuntimeError("Target PDF index is not empty; refusing to replace it")
        for name in ("items", "item_models", "chunks"):
            old_cols = [r[1] for r in old.execute(f"PRAGMA table_info({name})")]
            new_cols = [r[1] for r in new.execute(f"PRAGMA table_info({name})")]
            if old_cols != new_cols:
                raise RuntimeError(f"PDF schema mismatch: {name}")

    with closing(ro(old_note)) as old, closing(ro(new_note)) as new:
        available = count(old, "segment_vectors", "WHERE model_id=?", (args.old_model_id,))
        existing = count(new, "segment_vectors", "WHERE model_id=?", (args.new_model_id,))
        if not available:
            raise RuntimeError("No legacy note vectors for the specified model")
    sample_count, min_score = compare_note_vectors(
        new_note, old_note, args.old_model_id, args.new_model_id
    )
    print(
        f"Same Ollama digest {new_digest}; PDF {old_items} items / {old_chunks} chunks "
        f"(target {new_items}); note vectors old {available}, target {existing}; "
        f"{sample_count} matched vector samples, min cosine {min_score:.6f}"
    )
    if not args.apply:
        print("Dry run only. Close Zotero, then repeat with --apply to create backups and migrate.")
        return

    check_zotero_closed()
    for db_path in (old_pdf, new_pdf, old_note, new_note):
        for suffix in ("-wal", "-shm", "-journal"):
            if Path(str(db_path) + suffix).exists():
                raise RuntimeError(f"Database sidecar remains: {db_path}{suffix}")

    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    token = uuid.uuid4().hex[:8]
    pdf_backup = root / f"zotquery.sqlite.pre-migration-{stamp}-{token}.bak"
    note_backup = root / f"zotquery-lne.sqlite.pre-migration-{stamp}-{token}.bak"
    pdf_stage = root / f"zotquery.sqlite.migration-stage-{token}"
    note_stage = root / f"zotquery-lne.sqlite.migration-stage-{token}"
    backup_database(new_pdf, pdf_backup)
    backup_database(new_note, note_backup)
    backup_database(old_pdf, pdf_stage)
    backup_database(new_note, note_stage)
    print(f"Backups: {pdf_backup} ; {note_backup}")

    with closing(sqlite3.connect(pdf_stage)) as db:
        # This is a disposable stage copied from the untouched legacy DB.
        # Avoid journaling hundreds of MB of FTS trigger churn during remap.
        db.execute("PRAGMA journal_mode=OFF")
        db.execute("PRAGMA synchronous=OFF")
        db.execute("PRAGMA cache_size=-262144")
        fts_sql = db.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='chunks_fts'"
        ).fetchone()[0]
        triggers = db.execute(
            "SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name='chunks'"
        ).fetchall()
        if len(triggers) != 3:
            raise RuntimeError("Unexpected PDF full-text trigger layout")
        db.execute("BEGIN IMMEDIATE")
        for name, _ in triggers:
            db.execute(f"DROP TRIGGER {name}")
        db.execute("DROP TABLE chunks_fts")
        for table in ("items", "item_models", "chunks"):
            db.execute(
                f"UPDATE {table} SET model_id=? WHERE model_id=?",
                (args.new_model_id, args.old_model_id),
            )
        db.execute(fts_sql)
        db.execute(
            "INSERT INTO chunks_fts(chunk_text,item_pk,chunk_index,model_id) "
            "SELECT chunk_text,item_pk,chunk_index,model_id FROM chunks "
            "ORDER BY item_pk,chunk_index"
        )
        for _, sql in triggers:
            db.execute(sql)
        db.commit()
        if count(db, "item_models", "WHERE model_id=?", (args.new_model_id,)) != old_items:
            raise RuntimeError("PDF model remap verification failed")
        if count(db, "chunks_fts") != old_chunks:
            raise RuntimeError("PDF full-text rebuild count mismatch")
    verify_database(pdf_stage)

    with closing(sqlite3.connect(note_stage.as_uri() + "?mode=rw", uri=True)) as db:
        db.execute("ATTACH DATABASE ? AS legacy", (old_note.as_uri() + "?mode=ro",))
        db.execute("BEGIN IMMEDIATE")
        db.execute(
            "INSERT OR IGNORE INTO segment_vectors(hash,model_id,dim,embedding,created_at) "
            "SELECT v.hash, ?, v.dim, v.embedding, v.created_at "
            "FROM legacy.segment_vectors v "
            "WHERE v.model_id=? AND EXISTS "
            "(SELECT 1 FROM segments s WHERE s.hash=v.hash)",
            (args.new_model_id, args.old_model_id),
        )
        db.commit()
        migrated = count(db, "segment_vectors", "WHERE model_id=?", (args.new_model_id,))
        if migrated < existing:
            raise RuntimeError("Note vector count decreased")
    verify_database(note_stage)

    # Target DBs have been backed up and the application is closed. The old
    # ZotSeek DBs remain untouched. If a later step fails, backups remain.
    os.replace(pdf_stage, new_pdf)
    os.replace(note_stage, new_note)
    print(f"Migrated PDF {old_items} items / {old_chunks} chunks; note vectors now {migrated}.")


if __name__ == "__main__":
    main()
