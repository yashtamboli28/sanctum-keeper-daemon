"""LedgerManager subsystem providing WAL-backed SQLite3 persistence and atomic moves."""

from __future__ import annotations

import hashlib
import logging
import os
import shutil
import sqlite3
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path

logger = logging.getLogger(__name__)

CHUNK_SIZE_BYTES = 1024 * 1024  # 1 MiB streaming buffer for SHA-256 & copy


class TransactionStatus(str, Enum):
    """Lifecycle states recorded in the SQLite ledger for each file move."""

    COMMITTED = "COMMITTED"
    ROLLED_BACK = "ROLLED_BACK"
    SOURCE_UNLINK_PENDING = "SOURCE_UNLINK_PENDING"


class LedgerTransactionError(RuntimeError):
    """Raised when an atomic move or rollback violates safety invariants."""


@dataclass(frozen=True, slots=True)
class LedgerRecord:
    """Immutable representation of a row in the ``file_transactions`` table."""

    tx_id: str
    rule_id: str
    source_path: Path
    dest_path: Path
    sha256_hex: str
    file_size_bytes: int
    status: TransactionStatus
    created_at: str
    rolled_back_at: str | None = None


class LedgerManager:
    """Manages SQLite3 WAL ledger state and crash-safe atomic file transitions.

    Atomic Move Protocol (Copy -> DB Commit -> Unlink Original):
        Unlike ``shutil.move`` across filesystems—which can leave partial files
        or lose provenance on power failure—``execute_atomic_move`` enforces a
        strict three-phase sequence:

        1. **Stage & Fsync Copy**: Stream ``source_path`` into a hidden sibling
           file ``<dest>.sanctum_staging`` inside the destination directory,
           verify its SHA-256 digest matches the source, ``fsync`` the file
           descriptor to non-volatile media, and atomically ``os.replace`` it
           onto ``dest_path``. (If crash occurs here: original file is 100%
           untouched.)
        2. **Atomic SQLite WAL Write**: Acquire ``BEGIN IMMEDIATE`` lock and
           insert the ``COMMITTED`` ledger record with ``tx_id``, paths, and
           SHA-256 digest. If the DB transaction fails for any reason, remove
           ``dest_path`` immediately inside the error handler so zero orphan
           copies remain and the original stays intact.
        3. **Delete Original**: Unlink ``source_path``. If an OS lock prevents
           immediate deletion (common on Windows when antivirus scans a file),
           downgrade row status to ``SOURCE_UNLINK_PENDING`` rather than losing
           audit state so startup recovery can finalize cleanup safely.

    Concurrency Model:
        SQLite in ``WAL`` (Write-Ahead Logging) mode allows concurrent readers
        (e.g., future PyQt6 UI ledger table) alongside a single writer. All
        write transactions are serialized through ``self._write_lock`` and
        ``BEGIN IMMEDIATE`` with ``busy_timeout = 5000ms``.
    """

    def __init__(self, db_path: Path) -> None:
        self._db_path = db_path.expanduser().resolve()
        self._db_path.parent.mkdir(parents=True, exist_ok=True)

        # Serializes writer threads within this process; SQLite WAL handles
        # cross-connection read concurrency without blocking UI readers.
        self._write_lock = threading.RLock()
        self._local = threading.local()

        self._initialize_wal_schema()

    @property
    def db_path(self) -> Path:
        """Resolved filesystem path to the SQLite database file."""
        return self._db_path

    def _get_connection(self) -> sqlite3.Connection:
        """Return a thread-local SQLite connection configured with WAL pragmas.

        Using one connection per OS thread avoids ``check_same_thread=False``
        hazards while preserving prepared statement caches per worker thread.
        """
        conn: sqlite3.Connection | None = getattr(self._local, "conn", None)
        if conn is None:
            # isolation_level=None enables manual, explicit transaction control
            # ('BEGIN IMMEDIATE', 'COMMIT', 'ROLLBACK') without Python's
            # implicit magic transaction wrapper interfering with DDL/PRAGMAs.
            conn = sqlite3.connect(
                str(self._db_path),
                timeout=5.0,
                isolation_level=None,
            )
            conn.row_factory = sqlite3.Row

            # Mandatory durability & concurrency pragmas per connection:
            conn.execute("PRAGMA journal_mode = WAL;")
            conn.execute("PRAGMA synchronous = NORMAL;")
            conn.execute("PRAGMA foreign_keys = ON;")
            conn.execute("PRAGMA busy_timeout = 5000;")

            self._local.conn = conn
        return conn

    def _initialize_wal_schema(self) -> None:
        """Bootstrap WAL journal mode and create the ledger schema atomically."""
        with self._write_lock:
            conn = self._get_connection()
            journal_mode = conn.execute("PRAGMA journal_mode;").fetchone()[0]
            if str(journal_mode).lower() != "wal":
                logger.warning(
                    "Requested SQLite WAL mode on %s, active mode is '%s'",
                    self._db_path,
                    journal_mode,
                )

            conn.execute("BEGIN IMMEDIATE;")
            try:
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS file_transactions (
                        tx_id             TEXT PRIMARY KEY,
                        rule_id           TEXT NOT NULL,
                        source_path       TEXT NOT NULL,
                        dest_path         TEXT NOT NULL,
                        sha256_hex        TEXT NOT NULL,
                        file_size_bytes   INTEGER NOT NULL CHECK (file_size_bytes >= 0),
                        status            TEXT NOT NULL CHECK (
                            status IN ('COMMITTED', 'ROLLED_BACK', 'SOURCE_UNLINK_PENDING')
                        ),
                        created_at        TEXT NOT NULL,
                        rolled_back_at    TEXT
                    );
                    """
                )
                conn.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_file_tx_status_created
                    ON file_transactions (status, created_at DESC);
                    """
                )
                conn.execute("COMMIT;")
            except Exception:
                conn.execute("ROLLBACK;")
                raise

    @staticmethod
    def compute_sha256(file_path: Path) -> tuple[str, int]:
        """Stream ``file_path`` to compute ``(sha256_hex, total_bytes)``."""
        digest = hashlib.sha256()
        total_bytes = 0
        with file_path.open("rb") as handle:
            while chunk := handle.read(CHUNK_SIZE_BYTES):
                digest.update(chunk)
                total_bytes += len(chunk)
        return digest.hexdigest(), total_bytes

    @classmethod
    def _stage_and_promote_copy(
        cls,
        src: Path,
        dest: Path,
        expected_sha256: str,
    ) -> None:
        """Copy ``src`` to a staging file, verify SHA-256 + fsync, then promote.

        Raises:
            FileExistsError: If ``dest`` already exists (never silently clobber).
            LedgerTransactionError: If post-copy SHA-256 verification fails.
        """
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists():
            raise FileExistsError(
                f"Destination already exists; refusing overwrite: {dest}"
            )

        staging_path = dest.with_name(
            f".{dest.name}.{uuid.uuid4().hex[:8]}.sanctum_staging"
        )

        try:
            # Copy metadata + bytes into hidden staging file in target filesystem.
            shutil.copy2(src, staging_path)

            # Force kernel page-cache flush to physical storage before DB commit.
            with staging_path.open("rb") as staged_fd:
                os.fsync(staged_fd.fileno())

            staged_sha256, _ = cls.compute_sha256(staging_path)
            if staged_sha256 != expected_sha256:
                raise LedgerTransactionError(
                    f"Integrity mismatch copying {src} -> {staging_path}: "
                    f"expected {expected_sha256}, got {staged_sha256}"
                )

            # Re-check collision immediately prior to POSIX/NTFS atomic rename.
            if dest.exists():
                raise FileExistsError(
                    f"Concurrent collision detected at destination: {dest}"
                )

            os.replace(staging_path, dest)
        except Exception:
            staging_path.unlink(missing_ok=True)
            raise

    def execute_atomic_move(
        self,
        source_path: Path,
        dest_dir: Path,
        rule_id: str,
    ) -> LedgerRecord:
        """Execute a crash-safe move (Copy -> WAL DB Write -> Delete Original).

        Args:
            source_path: Existing file to organize.
            dest_dir: Target folder dictated by the matched ``Rule``.
            rule_id: Identifier of the ``Rule`` authorizing this transition.

        Returns:
            Committed ``LedgerRecord`` containing ``tx_id`` for future rollback.
        """
        resolved_src = source_path.expanduser().resolve()
        if not resolved_src.exists() or not resolved_src.is_file():
            raise FileNotFoundError(f"Source file unavailable: {resolved_src}")

        resolved_dest = dest_dir.expanduser().resolve() / resolved_src.name
        if resolved_src == resolved_dest:
            raise LedgerTransactionError(
                f"Source and destination paths are identical: {resolved_src}"
            )

        tx_id = str(uuid.uuid4())
        created_at = datetime.now(timezone.utc).isoformat()
        src_sha256, src_size = self.compute_sha256(resolved_src)

        with self._write_lock:
            # ------------------------------------------------------------------
            # PHASE 1: Copy to new destination via verified, fsynced staging file
            # ------------------------------------------------------------------
            self._stage_and_promote_copy(
                src=resolved_src,
                dest=resolved_dest,
                expected_sha256=src_sha256,
            )

            # ------------------------------------------------------------------
            # PHASE 2: Atomic SQLite WAL Transaction
            # ------------------------------------------------------------------
            conn = self._get_connection()
            conn.execute("BEGIN IMMEDIATE;")
            try:
                conn.execute(
                    """
                    INSERT INTO file_transactions (
                        tx_id, rule_id, source_path, dest_path,
                        sha256_hex, file_size_bytes, status, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
                    """,
                    (
                        tx_id,
                        rule_id,
                        str(resolved_src),
                        str(resolved_dest),
                        src_sha256,
                        src_size,
                        TransactionStatus.COMMITTED.value,
                        created_at,
                    ),
                )
                conn.execute("COMMIT;")
            except Exception as db_exc:
                conn.execute("ROLLBACK;")
                # Compensating cleanup: remove copied destination so original
                # remains the sole authoritative file on disk.
                resolved_dest.unlink(missing_ok=True)
                raise LedgerTransactionError(
                    f"WAL commit failed for tx {tx_id}; rolled back destination copy."
                ) from db_exc

            # ------------------------------------------------------------------
            # PHASE 3: Delete original source file
            # ------------------------------------------------------------------
            final_status = TransactionStatus.COMMITTED
            try:
                resolved_src.unlink()
            except OSError as unlink_exc:
                # Both copies exist and the ledger has durability; record pending
                # unlink so startup sweep can finish removing the stale original.
                logger.error(
                    "Committed tx %s to %s, but failed to delete original %s: %s",
                    tx_id,
                    resolved_dest,
                    resolved_src,
                    unlink_exc,
                )
                final_status = TransactionStatus.SOURCE_UNLINK_PENDING
                conn.execute("BEGIN IMMEDIATE;")
                try:
                    conn.execute(
                        "UPDATE file_transactions SET status = ? WHERE tx_id = ?;",
                        (final_status.value, tx_id),
                    )
                    conn.execute("COMMIT;")
                except Exception:
                    conn.execute("ROLLBACK;")

            logger.info(
                "Atomic move committed [tx_id=%s]: %s -> %s",
                tx_id,
                resolved_src,
                resolved_dest,
            )
            return LedgerRecord(
                tx_id=tx_id,
                rule_id=rule_id,
                source_path=resolved_src,
                dest_path=resolved_dest,
                sha256_hex=src_sha256,
                file_size_bytes=src_size,
                status=final_status,
                created_at=created_at,
            )

    def rollback(self, tx_id: str) -> LedgerRecord:
        """Reverse a previously committed transaction using the same 3-phase safety.

        Rollback Invariants:
            1. Transaction ``tx_id`` must exist and have ``status == 'COMMITTED'``.
            2. Current file at ``dest_path`` must match the recorded ``sha256_hex``
               (prevents silently overwriting or reverting user-modified files).
            3. ``source_path`` must not currently exist (never clobber new files).
            4. Copy ``dest_path`` -> ``source_path`` (staged + fsynced), update DB
               status to ``ROLLED_BACK`` inside ``BEGIN IMMEDIATE``, then unlink
               ``dest_path``.
        """
        with self._write_lock:
            conn = self._get_connection()
            row = conn.execute(
                "SELECT * FROM file_transactions WHERE tx_id = ?;",
                (tx_id,),
            ).fetchone()

            if row is None:
                raise KeyError(f"Transaction ID not found in ledger: {tx_id}")

            status = TransactionStatus(row["status"])
            if status != TransactionStatus.COMMITTED:
                raise LedgerTransactionError(
                    f"Cannot rollback tx {tx_id} in state '{status.value}'."
                )

            original_src = Path(row["source_path"])
            current_dest = Path(row["dest_path"])
            expected_sha256: str = row["sha256_hex"]

            if not current_dest.exists():
                raise FileNotFoundError(
                    f"Rollback aborted; organized file missing at {current_dest}"
                )

            if original_src.exists():
                raise FileExistsError(
                    f"Rollback aborted; a file already occupies original path {original_src}"
                )

            actual_sha256, _ = self.compute_sha256(current_dest)
            if actual_sha256 != expected_sha256:
                raise LedgerTransactionError(
                    f"Rollback aborted for tx {tx_id}: file at {current_dest} was "
                    "modified after organization (SHA-256 mismatch)."
                )

            # Phase 1: Stage & verify copy back to original source location.
            self._stage_and_promote_copy(
                src=current_dest,
                dest=original_src,
                expected_sha256=expected_sha256,
            )

            # Phase 2: Mark transaction ROLLED_BACK in SQLite WAL.
            rolled_back_at = datetime.now(timezone.utc).isoformat()
            conn.execute("BEGIN IMMEDIATE;")
            try:
                conn.execute(
                    """
                    UPDATE file_transactions
                    SET status = ?, rolled_back_at = ?
                    WHERE tx_id = ?;
                    """,
                    (TransactionStatus.ROLLED_BACK.value, rolled_back_at, tx_id),
                )
                conn.execute("COMMIT;")
            except Exception as db_exc:
                conn.execute("ROLLBACK;")
                original_src.unlink(missing_ok=True)
                raise LedgerTransactionError(
                    f"WAL update failed during rollback of tx {tx_id}; restored copy removed."
                ) from db_exc

            # Phase 3: Remove organized destination copy.
            current_dest.unlink()

            logger.info(
                "Rolled back transaction [tx_id=%s]: %s -> %s",
                tx_id,
                current_dest,
                original_src,
            )
            return LedgerRecord(
                tx_id=row["tx_id"],
                rule_id=row["rule_id"],
                source_path=original_src,
                dest_path=current_dest,
                sha256_hex=expected_sha256,
                file_size_bytes=int(row["file_size_bytes"]),
                status=TransactionStatus.ROLLED_BACK,
                created_at=row["created_at"],
                rolled_back_at=rolled_back_at,
            )

    def get_transaction(self, tx_id: str) -> LedgerRecord | None:
        """Fetch a single ledger transaction record by ``tx_id``."""
        conn = self._get_connection()
        row = conn.execute(
            "SELECT * FROM file_transactions WHERE tx_id = ?;",
            (tx_id,),
        ).fetchone()
        if row is None:
            return None
        return LedgerRecord(
            tx_id=row["tx_id"],
            rule_id=row["rule_id"],
            source_path=Path(row["source_path"]),
            dest_path=Path(row["dest_path"]),
            sha256_hex=row["sha256_hex"],
            file_size_bytes=int(row["file_size_bytes"]),
            status=TransactionStatus(row["status"]),
            created_at=row["created_at"],
            rolled_back_at=row["rolled_back_at"],
        )

    def close_thread_connection(self) -> None:
        """Close the calling thread's SQLite connection cleanly on thread exit."""
        conn: sqlite3.Connection | None = getattr(self._local, "conn", None)
        if conn is not None:
            conn.close()
            self._local.conn = None
