#!/usr/bin/env python3
"""Machine-readable progress wrapper around smritikosh's indexing pipeline.

Drives build_index() with the on_file_indexed callback and prints parseable
progress lines for the pi-smritikosh extension:

    SMK total <n>            — emitted once, after file discovery
    SMK progress <done> <n>  — emitted per indexed file
    SMK done <seconds>       — emitted on success
    SMK error <message>      — emitted on failure (exit code 1)

Usage: smk_progress.py REPO_PATH DB_PATH [--full]
"""
import sys
import time


def main() -> int:
    if len(sys.argv) < 3:
        print("SMK error usage: smk_progress.py REPO_PATH DB_PATH [--full]", flush=True)
        return 2

    repo_path, db_path = sys.argv[1], sys.argv[2]
    full = "--full" in sys.argv[3:]

    try:
        from smritikosh.adapters.embedder.resolver import (
            EmbedderUnavailableError,
            select_embedder,
        )
        from smritikosh.indexing.pipeline import build_index, count_source_files
        from smritikosh.cli import _open_stores
    except ImportError as exc:
        print(f"SMK error failed to import smritikosh: {exc}", flush=True)
        return 1

    try:
        embedder = select_embedder()
    except EmbedderUnavailableError as exc:
        print(f"SMK error {exc}", flush=True)
        return 1

    storage = None
    try:
        storage, vector_store = _open_stores(db_path)
        total = count_source_files(repo_path)
        print(f"SMK total {total}", flush=True)

        state = {"done": 0}

        def on_file_indexed(_path: str) -> None:
            state["done"] += 1
            print(f"SMK progress {state['done']} {total}", flush=True)

        started = time.perf_counter()
        build_index(
            repo_path,
            embedder,
            storage,
            vector_store,
            on_file_indexed=on_file_indexed,
            full=full,
        )
        elapsed = time.perf_counter() - started
        print(f"SMK done {elapsed:.1f}", flush=True)
        return 0
    except Exception as exc:  # surfaced to the extension for a clean warning
        print(f"SMK error {exc}", flush=True)
        return 1
    finally:
        if storage is not None:
            try:
                storage.close()
            except Exception:
                pass


if __name__ == "__main__":
    sys.exit(main())
