"""SanctumDaemon orchestrator coordinating Watchdog events, RuleEngine, and LedgerManager."""

from __future__ import annotations

import logging
import queue
import threading
from collections.abc import Iterable, Sequence
from types import TracebackType
from pathlib import Path

from sanctum_keeper.core.ledger import LedgerManager, LedgerRecord
from sanctum_keeper.core.rules import Rule, RuleEngine
from sanctum_keeper.core.watcher import FileWatcher
from sanctum_keeper.models.events import FileEvent

logger = logging.getLogger(__name__)


class SanctumDaemon:
    """Central asynchronous orchestrator for Sanctum Keeper.

    Concurrency Architecture:
        ``FileWatcher`` (producer thread) ---> ``queue.Queue[FileEvent | None]``
                                                        |
                                                        v
                                          ``SanctumDaemon._worker_loop``
                                            1. ``RuleEngine.evaluate()``
                                            2. ``LedgerManager.execute_atomic_move()``

    Design Decisions:
        - **Bounded Thread-Safe Queue**: ``queue.Queue(maxsize=max_queue_size)``
          decouples rapid filesystem bursts (e.g., unzipping an archive) from
          disk I/O without unbounded RAM growth.
        - **Poison-Pill Shutdown**: Pushing ``None`` onto ``event_queue`` wakes
          the blocked worker thread immediately for deterministic shutdown
          without polling delays or orphaned SQLite handles.
        - **Fault Isolation**: Exceptions raised while processing an individual
          ``FileEvent`` (locked file, vanishing temp file, destination collision)
          are logged and isolated per event; ``task_done()`` is guaranteed inside
          a ``finally`` block so ``queue.join()`` can never deadlock.
    """

    def __init__(
        self,
        db_path: Path,
        watch_dirs: Iterable[Path],
        rules: Sequence[Rule],
        *,
        recursive_watch: bool = False,
        max_queue_size: int = 4096,
    ) -> None:
        self._event_queue: queue.Queue[FileEvent | None] = queue.Queue(
            maxsize=max_queue_size
        )
        self._lifecycle_lock = threading.RLock()
        self._stop_event = threading.Event()
        self._worker_thread: threading.Thread | None = None
        self._running = False

        # Initialize core subsystems in dependency order:
        # 1. Durable SQLite WAL Ledger
        # 2. Validated, loop-checked RuleEngine
        # 3. Filtered Watchdog FileWatcher bound to our queue
        self._ledger = LedgerManager(db_path=db_path)
        self._rule_engine = RuleEngine(rules=rules)
        self._watcher = FileWatcher(
            watch_dirs=watch_dirs,
            event_queue=self._event_queue,
            recursive=recursive_watch,
        )

    @property
    def event_queue(self) -> queue.Queue[FileEvent | None]:
        """Expose the thread-safe event queue for subsystem & test inspection."""
        return self._event_queue

    @property
    def ledger(self) -> LedgerManager:
        """Expose the ``LedgerManager`` for rollbacks and audit queries."""
        return self._ledger

    @property
    def rule_engine(self) -> RuleEngine:
        """Expose the ``RuleEngine`` instance."""
        return self._rule_engine

    @property
    def watcher(self) -> FileWatcher:
        """Expose the ``FileWatcher`` instance."""
        return self._watcher

    @property
    def is_running(self) -> bool:
        """Return True if the orchestrator and worker thread are active."""
        with self._lifecycle_lock:
            return self._running

    def start(self) -> None:
        """Start the consumer worker thread and Watchdog filesystem observer."""
        with self._lifecycle_lock:
            if self._running:
                logger.warning("SanctumDaemon is already running.")
                return

            self._stop_event.clear()
            self._worker_thread = threading.Thread(
                target=self._worker_loop,
                name="SanctumDaemonWorker",
                daemon=False,  # Non-daemon ensures in-flight atomic moves finish cleanly
            )
            self._worker_thread.start()
            try:
                self._watcher.start()
            except Exception:
                # Roll back worker startup if Watchdog fails to schedule.
                self._stop_event.set()
                self._event_queue.put(None)
                self._worker_thread.join(timeout=5.0)
                self._worker_thread = None
                raise

            self._running = True
            logger.info("SanctumDaemon started (watching %d directories).", len(self._watcher.watch_dirs))

    def stop(self, drain_queue: bool = True, timeout: float = 10.0) -> None:
        """Gracefully stop ``FileWatcher`` and terminate the worker thread.

        Args:
            drain_queue: If True, process all already-queued events before
                exiting. If False, discard queued items after current atomic move.
            timeout: Maximum seconds to wait for the worker thread to join.
        """
        with self._lifecycle_lock:
            if not self._running:
                return
            self._running = False
            worker = self._worker_thread
            self._worker_thread = None

        # Step 1: Stop producer first so no new OS events enter the queue.
        self._watcher.stop()

        # Step 2: Optionally discard buffered unprocessed events on fast abort.
        if not drain_queue:
            self._stop_event.set()
            self._clear_pending_events()

        # Step 3: Enqueue poison-pill sentinel ('None') to unblock worker.get().
        try:
            self._event_queue.put(None, block=True, timeout=2.0)
        except queue.Full:
            self._stop_event.set()

        # Step 4: Join worker thread after it closes its thread-local SQLite conn.
        if worker is not None:
            worker.join(timeout=timeout)
            if worker.is_alive():
                logger.error("SanctumDaemon worker thread did not exit within %.1fs.", timeout)
            else:
                logger.info("SanctumDaemon shut down cleanly.")

    def rollback_transaction(self, tx_id: str) -> LedgerRecord:
        """Convenience facade to reverse a committed move while suppressing re-triggers."""
        record = self._ledger.get_transaction(tx_id)
        if record is not None:
            self._watcher.mark_path_in_flight(record.source_path)
        try:
            return self._ledger.rollback(tx_id)
        finally:
            if record is not None:
                self._watcher.unmark_path_in_flight(record.source_path)

    def _worker_loop(self) -> None:
        """Background consumer loop draining ``self._event_queue`` sequentially."""
        logger.debug("SanctumDaemon worker thread '%s' online.", threading.current_thread().name)
        try:
            while not self._stop_event.is_set():
                try:
                    item = self._event_queue.get(timeout=0.5)
                except queue.Empty:
                    continue

                try:
                    # Sentinel 'None' signals graceful worker shutdown.
                    if item is None:
                        logger.debug("Worker received shutdown sentinel.")
                        break

                    self._process_event(item)
                except Exception:
                    logger.exception("Unhandled error processing FileEvent: %r", item)
                finally:
                    self._event_queue.task_done()
        finally:
            # Always release thread-local SQLite WAL descriptors before thread exit.
            self._ledger.close_thread_connection()
            logger.debug("SanctumDaemon worker thread exited cleanly.")

    def _process_event(self, event: FileEvent) -> LedgerRecord | None:
        """Evaluate a single ``FileEvent`` and execute an atomic move on match."""
        candidate = event.path
        if not candidate.exists() or not candidate.is_file():
            logger.debug("Candidate file vanished before evaluation: %s", candidate)
            return None

        matched_rule = self._rule_engine.evaluate(candidate)
        if matched_rule is None:
            return None

        planned_dest = matched_rule.destination_dir.expanduser().resolve() / candidate.name

        # Suppress Watchdog feedback if destination sits inside a watched path.
        self._watcher.mark_path_in_flight(planned_dest)
        try:
            return self._ledger.execute_atomic_move(
                source_path=candidate,
                dest_dir=matched_rule.destination_dir,
                rule_id=matched_rule.rule_id,
            )
        finally:
            self._watcher.unmark_path_in_flight(planned_dest)

    def _clear_pending_events(self) -> None:
        """Drain remaining items without processing during immediate abort."""
        while True:
            try:
                _ = self._event_queue.get_nowait()
                self._event_queue.task_done()
            except queue.Empty:
                break

    def __enter__(self) -> SanctumDaemon:
        self.start()
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        self.stop(drain_queue=exc_type is None)
