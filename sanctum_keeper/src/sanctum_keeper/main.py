"""Headless CLI entrypoint demonstrating SanctumDaemon lifecycle and signal handling."""

from __future__ import annotations

import logging
import signal
import threading
from pathlib import Path

from sanctum_keeper.core.daemon import SanctumDaemon
from sanctum_keeper.core.rules import Rule, RuleCondition


def main() -> None:
    """Bootstrap SanctumDaemon in headless mode until SIGINT/SIGTERM."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(threadName)s %(name)s: %(message)s",
    )

    home = Path.home()
    downloads_dir = home / "Downloads"
    documents_dir = home / "Documents" / "Organized_PDFs"
    db_path = home / ".local" / "share" / "sanctum_keeper" / "ledger.sqlite3"

    downloads_dir.mkdir(parents=True, exist_ok=True)
    documents_dir.mkdir(parents=True, exist_ok=True)

    default_rules = [
        Rule(
            rule_id="rule_pdf_archive",
            name="PDF Documents to Organized_PDFs",
            priority=10,
            condition=RuleCondition(extensions=frozenset({".pdf"})),
            destination_dir=documents_dir,
        ),
    ]

    shutdown_signal = threading.Event()

    def _on_signal(signum: int, _frame: object) -> None:
        logging.info("Received signal %d; initiating graceful shutdown...", signum)
        shutdown_signal.set()

    signal.signal(signal.SIGINT, _on_signal)
    signal.signal(signal.SIGTERM, _on_signal)

    with SanctumDaemon(
        db_path=db_path,
        watch_dirs=[downloads_dir],
        rules=default_rules,
    ):
        shutdown_signal.wait()


if __name__ == "__main__":
    main()
