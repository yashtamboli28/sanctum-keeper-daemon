import daemonPy from '../../sanctum_keeper/src/sanctum_keeper/core/daemon.py?raw';
import ledgerPy from '../../sanctum_keeper/src/sanctum_keeper/core/ledger.py?raw';
import watcherPy from '../../sanctum_keeper/src/sanctum_keeper/core/watcher.py?raw';
import rulesPy from '../../sanctum_keeper/src/sanctum_keeper/core/rules.py?raw';
import eventsPy from '../../sanctum_keeper/src/sanctum_keeper/models/events.py?raw';
import mainPy from '../../sanctum_keeper/src/sanctum_keeper/main.py?raw';
import testLedgerPy from '../../sanctum_keeper/tests/test_ledger.py?raw';
import requirementsTxt from '../../sanctum_keeper/requirements.txt?raw';
import pyprojectToml from '../../sanctum_keeper/pyproject.toml?raw';

export interface BlueprintFile {
  id: string;
  name: string;
  relativePath: string;
  category: 'Core Deliverable' | 'Supporting Engine' | 'Project Config & Tests';
  subsystem: string;
  summary: string;
  language: 'python' | 'toml' | 'text';
  content: string;
  invariants: string[];
}

export const PROJECT_TREE_ASCII = `sanctum_keeper/
├── pyproject.toml                       # PEP 621 build config, mypy strict, pytest src-layout
├── requirements.txt                     # Pinned runtime & dev dependencies (Python 3.10+)
├── README.md                            # Architectural overview & operational runbook
├── src/
│   └── sanctum_keeper/
│       ├── __init__.py                  # Package version & public exports
│       ├── main.py                      # Headless daemon CLI & POSIX signal entrypoint
│       ├── core/
│       │   ├── __init__.py
│       │   ├── daemon.py                # SanctumDaemon: queue.Queue & worker lifecycle
│       │   ├── watcher.py               # FileWatcher: watchdog observer & path filtering
│       │   ├── rules.py                 # RuleEngine: deterministic matching & loop guard
│       │   └── ledger.py                # LedgerManager: SQLite3 WAL & 3-phase atomic moves
│       ├── models/
│       │   ├── __init__.py
│       │   └── events.py                # Frozen slots=True FileEvent value objects
│       └── ui/                          # Deferred PyQt6 desktop layer (decoupled from core)
│           └── __init__.py
└── tests/
    ├── conftest.py                      # Temporary filesystem & SQLite fixtures
    ├── test_daemon.py                   # Producer-consumer queue & poison-pill shutdown tests
    ├── test_watcher.py                  # Root directory & .tmp / .crdownload rejection tests
    ├── test_rules.py                    # Priority tie-breaking & loop detection tests
    └── test_ledger.py                   # WAL pragma, atomic 3-phase move & rollback(tx_id) tests`;

export const BLUEPRINT_FILES: BlueprintFile[] = [
  {
    id: 'daemon.py',
    name: 'daemon.py',
    relativePath: 'src/sanctum_keeper/core/daemon.py',
    category: 'Core Deliverable',
    subsystem: 'SanctumDaemon (Orchestrator)',
    summary:
      'Coordinates subsystem startup/shutdown, owns the bounded thread-safe queue.Queue, isolates worker exceptions per event, and drains cleanly via a None poison-pill sentinel.',
    language: 'python',
    content: daemonPy,
    invariants: [
      'Bounded queue.Queue(maxsize=4096) prevents unbounded memory growth during archive extraction bursts',
      'Producer stops before poison-pill sentinel (None) is enqueued for zero lost events on graceful exit',
      'task_done() executes inside finally blocks so queue.join() cannot deadlock on per-file OS errors',
      'Thread-local SQLite WAL handles are explicitly closed before worker thread termination',
    ],
  },
  {
    id: 'ledger.py',
    name: 'ledger.py',
    relativePath: 'src/sanctum_keeper/core/ledger.py',
    category: 'Core Deliverable',
    subsystem: 'LedgerManager (SQLite WAL)',
    summary:
      'Enforces SQLite WAL mode with BEGIN IMMEDIATE serialization, executes 3-phase crash-safe moves (staged copy + fsync -> WAL commit -> source unlink), and supports SHA-256 verified rollback(tx_id).',
    language: 'python',
    content: ledgerPy,
    invariants: [
      'PRAGMA journal_mode=WAL, synchronous=NORMAL, and busy_timeout=5000ms configured per thread connection',
      'Phase 1 writes to .sanctum_staging, verifies SHA-256 digest, calls os.fsync(), then os.replace()',
      'Phase 2 failure inside BEGIN IMMEDIATE triggers compensating unlink of destination so original stays untouched',
      'rollback(tx_id) verifies destination SHA-256 matches ledger before restoring to prevent clobbering user edits',
    ],
  },
  {
    id: 'watcher.py',
    name: 'watcher.py',
    relativePath: 'src/sanctum_keeper/core/watcher.py',
    category: 'Core Deliverable',
    subsystem: 'FileWatcher (Watchdog)',
    summary:
      'Wraps watchdog Observer, blocks OS root directories (/ , C:\\, /etc, C:\\Windows), filters .tmp / .crdownload / lock files, and suppresses self-induced feedback via an in-flight destination registry.',
    language: 'python',
    content: watcherPy,
    invariants: [
      'Rejects filesystem anchors and protected POSIX/Windows system paths both at registration and event time',
      'Ignores .tmp, .crdownload, .part, .partial, .sanctum_staging, ~$ Office locks, and directory events',
      'Captures FileMovedEvent.dest_path so browser downloads (.crdownload -> .pdf) trigger immediately upon completion',
      'Zero disk I/O or SQLite calls on the Watchdog callback thread; pushes frozen FileEvent objects with timeout',
    ],
  },
  {
    id: 'rules.py',
    name: 'rules.py',
    relativePath: 'src/sanctum_keeper/core/rules.py',
    category: 'Supporting Engine',
    subsystem: 'RuleEngine (Policy Evaluator)',
    summary:
      'Evaluates candidate files against priority-sorted immutable Rule objects (extension, byte bounds, filename prefix) and defines the detect_infinite_loops() graph validation boundary.',
    language: 'python',
    content: rulesPy,
    invariants: [
      'Rules sorted deterministically by (priority, rule_id) and stored in an immutable tuple snapshot',
      'Idempotency guard skips files already residing inside the matched rule destination directory',
      'Includes documented detect_infinite_loops() placeholder specifying directed-graph SCC cycle detection',
    ],
  },
  {
    id: 'events.py',
    name: 'events.py',
    relativePath: 'src/sanctum_keeper/models/events.py',
    category: 'Supporting Engine',
    subsystem: 'Domain Event Model',
    summary:
      'Python 3.10+ frozen slots=True dataclass representing normalized filesystem events crossing the Watchdog-to-Daemon thread boundary.',
    language: 'python',
    content: eventsPy,
    invariants: [
      '@dataclass(frozen=True, slots=True) prevents accidental cross-thread state mutation',
      'Normalized EventKind enum decouples RuleEngine from raw Watchdog event classes',
    ],
  },
  {
    id: 'main.py',
    name: 'main.py',
    relativePath: 'src/sanctum_keeper/main.py',
    category: 'Supporting Engine',
    subsystem: 'Headless Daemon Entrypoint',
    summary:
      'Demonstrates context-managed SanctumDaemon startup and graceful SIGINT/SIGTERM handling prior to PyQt6 GUI shell integration.',
    language: 'python',
    content: mainPy,
    invariants: [
      'Context manager guarantees FileWatcher stop and worker queue drain on SIGINT/SIGTERM',
    ],
  },
  {
    id: 'test_ledger.py',
    name: 'test_ledger.py',
    relativePath: 'tests/test_ledger.py',
    category: 'Project Config & Tests',
    subsystem: 'Pytest Atomic Verification',
    summary:
      'End-to-end pytest suite asserting active WAL journal mode, 3-phase atomic file transition, SHA-256 integrity, and idempotent rollback(tx_id) rejection.',
    language: 'python',
    content: testLedgerPy,
    invariants: [
      'Verifies PRAGMA journal_mode returns wal on disk',
      'Asserts double-rollback raises LedgerTransactionError cleanly',
    ],
  },
  {
    id: 'pyproject.toml',
    name: 'pyproject.toml',
    relativePath: 'pyproject.toml',
    category: 'Project Config & Tests',
    subsystem: 'Build & Strict Typing Config',
    summary:
      'Standard src-layout Python 3.10+ packaging manifest with strict mypy enforcement and pytest configuration.',
    language: 'toml',
    content: pyprojectToml,
    invariants: [
      'Enforces requires-python >= 3.10 and strict mypy checking across src/',
    ],
  },
  {
    id: 'requirements.txt',
    name: 'requirements.txt',
    relativePath: 'requirements.txt',
    category: 'Project Config & Tests',
    subsystem: 'Dependency Lock Specification',
    summary:
      'Runtime and development package specifications for watchdog, PyQt6 (deferred UI phase), pytest, mypy, and ruff.',
    language: 'text',
    content: requirementsTxt,
    invariants: [
      'sqlite3, queue, threading, hashlib, and pathlib rely strictly on Python 3.10+ standard library',
    ],
  },
];
