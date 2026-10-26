import React from 'react';

const PHASE_ROWS = [
  {
    step: 'Phase 1',
    operation: 'Stage, Verify SHA-256 & fsync',
    filesystemState: 'Source exists · .sanctum_staging promoted via os.replace()',
    crashOutcome:
      'Power loss leaves original source file 100% untouched; any leftover .sanctum_staging suffix is ignored by FileWatcher.',
  },
  {
    step: 'Phase 2',
    operation: 'SQLite WAL BEGIN IMMEDIATE Commit',
    filesystemState: 'Both source & verified destination exist momentarily',
    crashOutcome:
      'If INSERT fails or raises, compensating handler immediately unlinks destination copy before propagating LedgerTransactionError.',
  },
  {
    step: 'Phase 3',
    operation: 'Unlink Original Source File',
    filesystemState: 'Destination authoritative · Ledger status COMMITTED',
    crashOutcome:
      'If OS file lock blocks unlink (e.g. Windows AV scan), row transitions to SOURCE_UNLINK_PENDING for deterministic startup cleanup.',
  },
  {
    step: 'Rollback',
    operation: 'rollback(tx_id) Reversal',
    filesystemState: 'Verifies destination SHA-256 == ledger sha256_hex first',
    crashOutcome:
      'Refuses rollback if user modified the organized file or if a new file now occupies source_path; restores via identical 3-phase sequence.',
  },
];

export const ArchitectureSpecSection: React.FC = () => {
  return (
    <section id="architecture-spec" className="scroll-mt-20">
      <div className="mb-6">
        <p className="text-xs font-medium text-teal-700 mb-1">
          03. Concurrency & Crash-Safety Design
        </p>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
          Thread Model & Three-Phase WAL Transaction Protocol
        </h2>
        <p className="text-sm text-slate-600 mt-1 max-w-3xl">
          Cross-filesystem moves cannot rely on a single POSIX <code className="font-mono text-xs text-slate-800">rename(2)</code> syscall. Sanctum Keeper pairs thread-local SQLite WAL connections with an explicit three-phase copy-commit-unlink protocol.
        </p>
      </div>

      {/* Threading & Subsystem Pipeline Overview */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden mb-8">
        <div className="grid grid-cols-1 md:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-slate-200">
          <div className="p-6">
            <div className="text-xs font-mono text-teal-700 mb-1">
              Thread 1 · Watchdog Observer
            </div>
            <h3 className="text-sm font-semibold text-slate-900 mb-2">
              FileWatcher Producer
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Validates resolved paths against OS roots and ignores <code className="font-mono">.tmp</code> / <code className="font-mono">.crdownload</code> artifacts. Performs zero disk writes or DB queries; pushes frozen <code className="font-mono">FileEvent</code> records to the queue.
            </p>
          </div>

          <div className="p-6">
            <div className="text-xs font-mono text-teal-700 mb-1">
              Synchronization · Bounded FIFO
            </div>
            <h3 className="text-sm font-semibold text-slate-900 mb-2">
              queue.Queue[FileEvent | None]
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Bounded <code className="font-mono">maxsize=4096</code> absorbs rapid archive extraction bursts with backpressure. Uses a <code className="font-mono">None</code> poison-pill sentinel for immediate, deterministic worker shutdown.
            </p>
          </div>

          <div className="p-6">
            <div className="text-xs font-mono text-teal-700 mb-1">
              Thread 2 · SanctumDaemonWorker
            </div>
            <h3 className="text-sm font-semibold text-slate-900 mb-2">
              RuleEngine + In-Flight Guard
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Evaluates candidate files against immutable <code className="font-mono">(priority, rule_id)</code> sorted rules, registers planned destinations in <code className="font-mono">in_flight_paths</code> to prevent Watchdog echo loops, and invokes <code className="font-mono">LedgerManager</code>.
            </p>
          </div>

          <div className="p-6">
            <div className="text-xs font-mono text-teal-700 mb-1">
              Persistence · SQLite3 WAL
            </div>
            <h3 className="text-sm font-semibold text-slate-900 mb-2">
              LedgerManager Atomic Store
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Uses <code className="font-mono">threading.local()</code> connections with <code className="font-mono">isolation_level=None</code>, <code className="font-mono">PRAGMA journal_mode=WAL</code>, and explicit <code className="font-mono">BEGIN IMMEDIATE</code> locks so future PyQt6 UI reads never block moves.
            </p>
          </div>
        </div>
      </div>

      {/* 3-Phase Atomic Protocol Matrix */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">
            Failure-Mode Matrix for LedgerManager.execute_atomic_move() & rollback(tx_id)
          </h3>
          <span className="text-xs text-slate-500 font-mono">
            PRAGMA journal_mode = WAL · synchronous = NORMAL · busy_timeout = 5000
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                <th className="py-3 px-6 whitespace-nowrap">Stage</th>
                <th className="py-3 px-6 whitespace-nowrap">Engine Operation</th>
                <th className="py-3 px-6 whitespace-nowrap">On-Disk State</th>
                <th className="py-3 px-6">Crash / Exception Guarantee</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {PHASE_ROWS.map((row) => (
                <tr key={row.step} className="hover:bg-slate-50/60 transition-colors">
                  <td className="py-3.5 px-6 font-mono font-semibold text-slate-900 whitespace-nowrap">
                    {row.step}
                  </td>
                  <td className="py-3.5 px-6 font-medium text-slate-800 whitespace-nowrap">
                    {row.operation}
                  </td>
                  <td className="py-3.5 px-6 font-mono text-slate-600">
                    {row.filesystemState}
                  </td>
                  <td className="py-3.5 px-6 text-slate-600 leading-relaxed">
                    {row.crashOutcome}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
};
