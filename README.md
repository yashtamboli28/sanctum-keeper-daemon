# Sanctum Keeper

**Sanctum Keeper** is a deterministic, offline file-organization daemon written in **Python 3.10+**, paired with an interactive browser-based **Architecture Workbench & Atomic Transaction Simulator** in this repository.

---

## Repository Overview

```text
.
├── README.md                            # Root repository documentation
├── sanctum_keeper/                      # Complete Python 3.10+ daemon package (src-layout)
│   ├── README.md                        # Python package architecture & operational runbook
│   ├── pyproject.toml                   # PEP 621 build config, strict mypy & pytest settings
│   ├── requirements.txt                 # Runtime & development dependencies
│   ├── src/
│   │   └── sanctum_keeper/
│   │       ├── __init__.py
│   │       ├── main.py                  # Headless CLI entrypoint & signal lifecycle
│   │       ├── core/
│   │       │   ├── daemon.py            # SanctumDaemon: bounded queue.Queue & worker thread
│   │       │   ├── watcher.py           # FileWatcher: watchdog observer & path filtering
│   │       │   ├── rules.py             # RuleEngine: deterministic matching & loop boundary
│   │       │   └── ledger.py            # LedgerManager: SQLite3 WAL & 3-phase atomic moves
│   │       ├── models/
│   │       │   └── events.py            # Frozen slots=True FileEvent domain objects
│   │       └── ui/                      # Deferred PyQt6 desktop layer namespace
│   │           └── __init__.py
│   └── tests/
│       └── test_ledger.py               # WAL mode, atomic move & rollback(tx_id) test suite
└── src/                                 # Interactive Architecture Workbench & Simulator (React/Vite)
```

---

## Core Python Architecture

1. **`SanctumDaemon` (`core/daemon.py`)**
   * Coordinates subsystem lifecycles (`LedgerManager`, `RuleEngine`, `FileWatcher`) using an in-memory, thread-safe bounded `queue.Queue[FileEvent | None](maxsize=4096)`.
   * Isolates per-event errors inside the worker loop while guaranteeing `task_done()` in `finally` blocks and clean shutdown via a `None` poison-pill sentinel.
2. **`FileWatcher` (`core/watcher.py`)**
   * Uses `watchdog` to monitor explicit user folders while blocking OS system roots (`/`, `/etc`, `/usr`, `/System`, `C:\`, `C:\Windows`, `C:\Program Files`).
   * Ignores incomplete transfers and lock files (`.tmp`, `.crdownload`, `.part`, `.partial`, `.sanctum_staging`, `~$` prefixes) and captures `FileMovedEvent.dest_path` so finalized browser downloads are organized immediately.
   * Tracks `in_flight_paths` to suppress self-induced Watchdog echoes when moving files into watched subdirectories.
3. **`RuleEngine` (`core/rules.py`)**
   * Evaluates immutable `@dataclass(frozen=True, slots=True)` rules sorted deterministically by `(priority, rule_id)` and defines `detect_infinite_loops()` for static cycle validation.
4. **`LedgerManager` (`core/ledger.py`)**
   * Configures thread-local SQLite3 connections with `PRAGMA journal_mode = WAL`, `PRAGMA synchronous = NORMAL`, and `PRAGMA busy_timeout = 5000` using explicit `BEGIN IMMEDIATE` write transactions.
   * Executes crash-safe **Three-Phase Atomic Moves**:
     1. Stream copy to hidden `.sanctum_staging` file in destination, verify SHA-256 parity, call `os.fsync()`, and promote via `os.replace()`.
     2. Record `COMMITTED` transaction in SQLite WAL (with compensating destination unlink on DB failure so the source file remains untouched).
     3. Unlink original source file.
   * Provides deterministic **`rollback(tx_id)`**, verifying the organized file's SHA-256 matches the ledger digest before restoring it to its original path.

---

## Quick Start

### Python Engine (`sanctum_keeper/`)

```bash
cd sanctum_keeper
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"

# Run the SQLite WAL & atomic rollback test suite
pytest

# Type-check with strict mypy
mypy src

# Start the headless daemon (organizes ~/Downloads PDFs -> ~/Documents/Organized_PDFs)
sanctum-daemon
```

### Architecture Workbench Web UI

```bash
npm install
npm run dev
```

Open `http://localhost:3000` to inspect all Python modules, explore the three-phase failure matrix, test Watchdog filtering and `rollback(tx_id)` in the interactive simulator, or export `setup_sanctum_keeper.sh`.
