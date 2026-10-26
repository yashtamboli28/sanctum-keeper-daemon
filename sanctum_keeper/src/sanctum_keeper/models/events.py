"""Immutable domain events and value objects shared across Sanctum Keeper subsystems."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path


class EventKind(str, Enum):
    """Supported filesystem triggers normalized for the RuleEngine."""

    CREATED = "CREATED"
    MOVED_INTO = "MOVED_INTO"
    MODIFIED = "MODIFIED"


@dataclass(frozen=True, slots=True)
class FileEvent:
    """Thread-safe, immutable value object pushed onto SanctumDaemon's queue.

    Using ``frozen=True`` and ``slots=True`` (Python 3.10+) prevents accidental
    cross-thread mutation between the Watchdog producer thread and the Daemon
    consumer worker thread while minimizing per-event memory overhead.
    """

    path: Path
    kind: EventKind
    observed_at: datetime = field(
        default_factory=lambda: datetime.now(timezone.utc)
    )
    event_id: str = ""
