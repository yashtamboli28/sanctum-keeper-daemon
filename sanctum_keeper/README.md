# Sanctum Keeper — Core Python Daemon

Deterministic, offline file-organization engine built on **Python 3.10+**, **`watchdog`**, and **SQLite3 (`WAL` mode)**.

---

## Subsystem Responsibilities

| Module | Class | Responsibility |
| :--- | :--- | :--- |
| `core/daemon.py` | `SanctumDaemon` | Owns bounded `queue.Queue(maxsize=4096)`, manages subsystem startup/shutdown order, drains events on a dedicated worker thread, and terminates cleanly via a `None` poison-pill sentinel. |
| `core/watcher.py` | `FileWatcher` | Wraps `watchdog.observers.Observer`, rejects OS root trees (`/`, `/etc`, `C:\Windows`), drops `.tmp` / `.crdownload` / `.part` / `~$` lock artifacts, and suppresses in-flight destination echoes. |
| `core/rules.py` | `RuleEngine` | Evaluates frozen `Rule` predicates in deterministic `(priority, rule_id)` order, prevents redundant moves within target directories, and defines the `detect_infinite_loops()` cycle check boundary. |
| `core/ledger.py` | `LedgerManager` | Configures thread-local SQLite3 connections in `WAL` mode with `BEGIN IMMEDIATE` serialization, performs 3-phase staged + `fsync` atomic moves, and supports SHA-256 verified `rollback(tx_id)`. |

---

## Atomic Move & Rollback Protocol

Cross-volume file moves cannot rely on a single atomic `rename(2)` syscall. `LedgerManager.execute_atomic_move()` enforces three crash-safe phases:

1. **Stage, Verify & Promote**: Copies `source_path` to `.<filename>.<nonce>.sanctum_staging` inside the target folder, calls `os.fsync()`, verifies SHA-256 parity against the source, and atomically promotes it via `os.replace()`.
2. **SQLite WAL Commit**: Executes `BEGIN IMMEDIATE` and inserts the `COMMITTED` row into `file_transactions`. If the database write fails, a compensating handler immediately unlinks the destination copy so the original file remains the sole copy on disk.
3. **Source Unlink**: Removes `source_path`. If a transient OS lock blocks deletion, the ledger row transitions to `SOURCE_UNLINK_PENDING` so startup recovery can complete cleanup without data loss.

Calling `ledger.rollback(tx_id)` validates that the file at `dest_path` still matches its recorded `sha256_hex` (protecting any post-move user edits) and that `source_path` is unoccupied before reversing the transition using the exact same three-phase guarantee.

---

## Development & Verification

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"

# Run unit & integration tests
pytest -v

# Run strict static type analysis
mypy src

# Run headless daemon
sanctum-daemon
```
