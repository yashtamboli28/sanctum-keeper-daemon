"""Integration tests verifying SQLite WAL mode, atomic 3-phase moves, and rollback(tx_id)."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from sanctum_keeper.core.ledger import (
    LedgerManager,
    LedgerTransactionError,
    TransactionStatus,
)


def test_wal_journal_mode_and_atomic_move_with_rollback(tmp_path: Path) -> None:
    db_file = tmp_path / "state" / "ledger.sqlite3"
    inbox_dir = tmp_path / "inbox"
    archive_dir = tmp_path / "archive"
    inbox_dir.mkdir()

    sample_file = inbox_dir / "invoice_2026.pdf"
    original_bytes = b"%PDF-1.7 deterministic payload"
    sample_file.write_bytes(original_bytes)

    ledger = LedgerManager(db_path=db_file)

    # Verify SQLite WAL mode is enabled on disk.
    with sqlite3.connect(db_file) as verify_conn:
        mode = verify_conn.execute("PRAGMA journal_mode;").fetchone()[0]
        assert str(mode).lower() == "wal"

    # Execute atomic 3-phase move (Copy -> WAL Commit -> Delete Original).
    record = ledger.execute_atomic_move(
        source_path=sample_file,
        dest_dir=archive_dir,
        rule_id="rule_invoices",
    )

    assert record.status == TransactionStatus.COMMITTED
    assert not sample_file.exists()
    assert (archive_dir / "invoice_2026.pdf").read_bytes() == original_bytes

    # Execute deterministic rollback(tx_id).
    rolled_back = ledger.rollback(record.tx_id)
    assert rolled_back.status == TransactionStatus.ROLLED_BACK
    assert sample_file.read_bytes() == original_bytes
    assert not (archive_dir / "invoice_2026.pdf").exists()

    # Re-running rollback on an already rolled-back tx_id must fail cleanly.
    with pytest.raises(LedgerTransactionError):
        ledger.rollback(record.tx_id)

    ledger.close_thread_connection()
