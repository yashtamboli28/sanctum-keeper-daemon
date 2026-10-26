"""FileWatcher subsystem wrapping watchdog with strict root & temp-file guards."""

from __future__ import annotations

import logging
import os
import queue
import threading
import uuid
from collections.abc import Iterable
from pathlib import Path

from watchdog.events import (
    FileCreatedEvent,
    FileMovedEvent,
    FileSystemEvent,
    FileSystemEventHandler,
)
from watchdog.observers import Observer
from watchdog.observers.api import BaseObserver

from sanctum_keeper.models.events import EventKind, FileEvent

logger = logging.getLogger(__name__)

# Ignored ephemeral / partial-download extensions (lowercase).
IGNORED_EXTENSIONS: frozenset[str] = frozenset(
    {
        ".tmp",
        ".crdownload",
        ".part",
        ".partial",
        ".download",
        ".sanctum_staging",
    }
)

# Ignored lock/system filenames and prefixes.
IGNORED_FILENAMES: frozenset[str] = frozenset({".ds_store", "thumbs.db", "desktop.ini"})
IGNORED_PREFIXES: tuple[str, ...] = ("~$", ".~lock.")

# POSIX & Windows system paths prohibited as watch roots or event targets.
PROTECTED_POSIX_PATHS: frozenset[Path] = frozenset(
    Path(p)
    for p in (
        "/",
        "/bin",
        "/boot",
        "/dev",
        "/etc",
        "/lib",
        "/lib64",
        "/proc",
        "/root",
        "/run",
        "/sbin",
        "/sys",
        "/usr",
        "/var",
        "/System",
        "/Library",
    )
)


def is_protected_system_path(candidate: Path) -> bool:
    """Return True if ``candidate`` resolves to a filesystem root or OS tree.

    Protects against accidental catastrophic organization of OS binaries,
    bootloader files, or root drive contents across POSIX and Windows hosts.
    """
    resolved = candidate.resolve()

    # Reject raw filesystem roots such as '/' on POSIX or 'C:\\' on Windows.
    if resolved == Path(resolved.anchor):
        return True

    if os.name == "nt":
        system_root = Path(os.environ.get("SystemRoot", r"C:\Windows")).resolve()
        prog_files = Path(os.environ.get("ProgramFiles", r"C:\Program Files")).resolve()
        prog_files_x86 = Path(
            os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
        ).resolve()
        for protected_win in (system_root, prog_files, prog_files_x86):
            if resolved == protected_win or protected_win in resolved.parents:
                return True
    else:
        for protected_posix in PROTECTED_POSIX_PATHS:
            if resolved == protected_posix:
                return True
            # Block subdirectories under sensitive kernel/OS trees (except /var/folders on macOS tests if explicitly allowed, here strictly blocked).
            if protected_posix != Path("/") and protected_posix in resolved.parents:
                return True

    return False


def is_temporary_or_ignored_artifact(path: Path) -> bool:
    """Return True if ``path`` represents an incomplete download or lock file."""
    filename_lower = path.name.lower()

    if filename_lower in IGNORED_FILENAMES:
        return True

    if filename_lower.startswith(IGNORED_PREFIXES):
        return True

    # Check terminal suffix (.tmp, .crdownload, .part, .sanctum_staging).
    if path.suffix.lower() in IGNORED_EXTENSIONS:
        return True

    return False


class _SanctumEventHandler(FileSystemEventHandler):
    """Internal Watchdog handler translating raw OS callbacks into ``FileEvent``s.

    Concurrency Note:
        Watchdog invokes ``on_created`` and ``on_moved`` on its own background
        observer thread. This handler performs zero disk mutations or SQLite
        calls; it strictly validates paths and enqueues immutable ``FileEvent``
        objects onto the thread-safe ``queue.Queue`` owned by ``SanctumDaemon``.
    """

    def __init__(
        self,
        event_queue: queue.Queue[FileEvent | None],
        in_flight_paths: set[Path],
        in_flight_lock: threading.RLock,
    ) -> None:
        super().__init__()
        self._event_queue = event_queue
        self._in_flight_paths = in_flight_paths
        self._in_flight_lock = in_flight_lock

    def on_created(self, event: FileSystemEvent) -> None:
        """Handle newly created files (ignores directory creation)."""
        if event.is_directory or not isinstance(event, FileCreatedEvent):
            return
        self._filter_and_enqueue(Path(os.fsdecode(event.src_path)), EventKind.CREATED)

    def on_moved(self, event: FileSystemEvent) -> None:
        """Handle atomic browser renames (e.g., foo.pdf.crdownload -> foo.pdf).

        Modern browsers write to ``.crdownload`` / ``.part`` first and issue an
        atomic rename upon completion. Capturing ``dest_path`` on ``FileMovedEvent``
        ensures completed downloads are organized immediately once finalized.
        """
        if event.is_directory or not isinstance(event, FileMovedEvent):
            return
        self._filter_and_enqueue(
            Path(os.fsdecode(event.dest_path)), EventKind.MOVED_INTO
        )

    def _filter_and_enqueue(self, raw_path: Path, kind: EventKind) -> None:
        """Validate candidate path and push ``FileEvent`` to the daemon queue."""
        try:
            resolved = raw_path.resolve()
        except OSError:
            return

        if is_temporary_or_ignored_artifact(resolved):
            logger.debug("Ignored temporary/lock artifact: %s", resolved)
            return

        if is_protected_system_path(resolved):
            logger.warning("Blocked event from protected system path: %s", resolved)
            return

        # Suppress feedback loops caused by LedgerManager's own atomic moves.
        with self._in_flight_lock:
            if resolved in self._in_flight_paths:
                logger.debug("Suppressed self-generated move event for: %s", resolved)
                return

        file_event = FileEvent(
            path=resolved,
            kind=kind,
            event_id=uuid.uuid4().hex,
        )

        try:
            # Bounded timeout prevents indefinitely stalling the OS observer
            # thread if the consumer queue experiences heavy backpressure.
            self._event_queue.put(file_event, block=True, timeout=2.0)
            logger.debug("Enqueued %s event for %s", kind.value, resolved)
        except queue.Full:
            logger.error(
                "SanctumDaemon event queue is full; dropped %s event for %s",
                kind.value,
                resolved,
            )


class FileWatcher:
    """Lifecycle wrapper around Watchdog's ``Observer`` thread.

    Responsibilities:
        - Validates all configured watch directories at registration time,
          refusing system roots (``/``, ``C:\\``, ``/etc``, ``C:\\Windows``).
        - Filters ``.tmp``, ``.crdownload``, ``.part``, and internal staging
          files before events ever reach ``SanctumDaemon``.
        - Maintains a thread-safe ``in_flight_paths`` registry so ``LedgerManager``
          can suppress self-induced filesystem events when moving files into
          subdirectories that are also watched.
    """

    def __init__(
        self,
        watch_dirs: Iterable[Path],
        event_queue: queue.Queue[FileEvent | None],
        recursive: bool = False,
    ) -> None:
        self._event_queue = event_queue
        self._recursive = recursive
        self._watch_dirs: list[Path] = []
        self._observer: BaseObserver | None = None
        self._state_lock = threading.RLock()

        # Shared set of paths currently being written by LedgerManager.
        self._in_flight_paths: set[Path] = set()
        self._in_flight_lock = threading.RLock()

        for directory in watch_dirs:
            self.add_watch_dir(directory)

    @property
    def watch_dirs(self) -> tuple[Path, ...]:
        """Return an immutable snapshot of validated watch directories."""
        with self._state_lock:
            return tuple(self._watch_dirs)

    def add_watch_dir(self, directory: Path) -> None:
        """Validate and register a user directory for monitoring.

        Raises:
            ValueError: If ``directory`` is a system root or protected OS path.
            FileNotFoundError: If ``directory`` does not exist or isn't a directory.
        """
        resolved = directory.expanduser().resolve()
        if is_protected_system_path(resolved):
            raise ValueError(
                f"Refusing to monitor protected system directory: {resolved}"
            )
        if not resolved.exists() or not resolved.is_dir():
            raise FileNotFoundError(
                f"Watch target does not exist or is not a directory: {resolved}"
            )

        with self._state_lock:
            if resolved not in self._watch_dirs:
                self._watch_dirs.append(resolved)

    def mark_path_in_flight(self, path: Path) -> None:
        """Register a destination path prior to atomic move to avoid self-triggers."""
        with self._in_flight_lock:
            self._in_flight_paths.add(path.resolve())

    def unmark_path_in_flight(self, path: Path) -> None:
        """Remove a destination path from the suppression set once settled."""
        with self._in_flight_lock:
            self._in_flight_paths.discard(path.resolve())

    def start(self) -> None:
        """Spawn and start the Watchdog ``Observer`` thread."""
        with self._state_lock:
            if self._observer is not None and self._observer.is_alive():
                logger.warning("FileWatcher is already running.")
                return

            handler = _SanctumEventHandler(
                event_queue=self._event_queue,
                in_flight_paths=self._in_flight_paths,
                in_flight_lock=self._in_flight_lock,
            )
            observer = Observer()
            observer.daemon = True

            for directory in self._watch_dirs:
                observer.schedule(handler, str(directory), recursive=self._recursive)
                logger.info(
                    "Scheduled FileWatcher on %s (recursive=%s)",
                    directory,
                    self._recursive,
                )

            observer.start()
            self._observer = observer

    def stop(self, join_timeout: float = 5.0) -> None:
        """Signal the Watchdog ``Observer`` to halt and join its thread cleanly."""
        with self._state_lock:
            observer = self._observer
            self._observer = None

        if observer is not None:
            observer.stop()
            observer.join(timeout=join_timeout)
            logger.info("FileWatcher stopped cleanly.")
