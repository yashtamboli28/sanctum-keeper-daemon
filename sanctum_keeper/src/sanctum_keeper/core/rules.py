"""Deterministic RuleEngine subsystem for evaluating file organization policies."""

from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class RuleCondition:
    """Declarative predicate set evaluated deterministically against a file."""

    extensions: frozenset[str] = frozenset()
    min_size_bytes: int | None = None
    max_size_bytes: int | None = None
    filename_prefix: str | None = None

    def matches(self, file_path: Path, size_bytes: int) -> bool:
        """Return True only if every configured constraint is satisfied."""
        if self.extensions:
            normalized_ext = file_path.suffix.lower()
            if normalized_ext not in self.extensions:
                return False

        if self.min_size_bytes is not None and size_bytes < self.min_size_bytes:
            return False

        if self.max_size_bytes is not None and size_bytes > self.max_size_bytes:
            return False

        if (
            self.filename_prefix is not None
            and not file_path.name.startswith(self.filename_prefix)
        ):
            return False

        return True


@dataclass(frozen=True, slots=True)
class Rule:
    """Immutable routing rule mapping matching files to a target directory."""

    rule_id: str
    name: str
    priority: int
    condition: RuleCondition
    destination_dir: Path
    enabled: bool = True


class RuleLoopError(RuntimeError):
    """Raised when a rule set could trigger a non-terminating move cycle."""


class RuleEngine:
    """Evaluates candidate files against deterministic, priority-ordered rules.

    Thread-Safety Contract:
        ``Rule`` instances are frozen dataclasses stored in an immutable tuple
        reference. Rule reloads atomically swap the tuple reference so reader
        threads never observe partially mutated rule lists.
    """

    def __init__(self, rules: Sequence[Rule] | None = None) -> None:
        initial_rules = list(rules or ())
        loops = self.detect_infinite_loops(initial_rules)
        if loops:
            cycle_desc = ", ".join(f"{a.rule_id} -> {b.rule_id}" for a, b in loops)
            raise RuleLoopError(f"Cyclic routing rules detected: {cycle_desc}")

        # Lower numerical priority value executes first; tie-break by rule_id
        # to guarantee 100% deterministic evaluation across runs.
        self._rules: tuple[Rule, ...] = tuple(
            sorted(initial_rules, key=lambda r: (r.priority, r.rule_id))
        )

    @property
    def rules(self) -> tuple[Rule, ...]:
        """Return an immutable snapshot of active rules."""
        return self._rules

    def evaluate(self, file_path: Path) -> Rule | None:
        """Evaluate ``file_path`` against ordered rules and return first match.

        Returns ``None`` if the file no longer exists, is inaccessible, already
        resides inside the rule's target directory, or matches no active rule.
        """
        try:
            stat_result = file_path.stat()
        except OSError as exc:
            logger.debug("Skipping rule evaluation; stat failed for %s: %s", file_path, exc)
            return None

        resolved_parent = file_path.resolve().parent

        for rule in self._rules:
            if not rule.enabled:
                continue

            # Idempotency guard: never re-move a file already in its target folder.
            if resolved_parent == rule.destination_dir.resolve():
                continue

            if rule.condition.matches(file_path, size_bytes=stat_result.st_size):
                logger.debug("File %s matched rule '%s' (%s)", file_path, rule.name, rule.rule_id)
                return rule

        return None

    def detect_infinite_loops(
        self,
        rules: Sequence[Rule],
        watched_dirs: Sequence[Path] | None = None,
    ) -> list[tuple[Rule, Rule]]:
        """Placeholder for static directed-graph cycle detection across rules.

        Architectural Intent (Phase 2 Implementation):
            1. Build a directed graph G = (V, E) where each vertex v in V is an
               enabled ``Rule``.
            2. Add a directed edge (Rule_A -> Rule_B) whenever:
               - ``Rule_A.destination_dir`` is equal to or nested beneath any
                 monitored directory in ``watched_dirs``, AND
               - ``Rule_A``'s output file attributes (e.g., preserved extension,
                 renamed prefix, size bounds) overlap with ``Rule_B.condition``
                 while ``Rule_B.destination_dir != Rule_A.destination_dir``.
            3. Run Tarjan's Strongly Connected Components (SCC) or three-color
               DFS cycle detection in O(V + E) time to reject cyclic rule graphs
               before activating the daemon.

        Args:
            rules: Candidate sequence of ``Rule`` definitions to validate.
            watched_dirs: Optional list of directories monitored by ``FileWatcher``.

        Returns:
            A list of ``(producer_rule, consumer_rule)`` pairs participating in
            a potential routing cycle. Empty list indicates an acyclic rule set.
        """
        _ = (rules, watched_dirs)
        logger.debug("RuleEngine.detect_infinite_loops() placeholder invoked.")
        return []
