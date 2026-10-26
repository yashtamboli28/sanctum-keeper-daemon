import React, { useState } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Play,
  Plus,
  Trash2,
  ShieldAlert,
} from 'lucide-react';

interface SimulatedFile {
  path: string;
  sizeBytes: number;
  sha256: string;
}

interface QueuedEvent {
  eventId: string;
  path: string;
  kind: 'CREATED' | 'MOVED_INTO';
  enqueuedAt: string;
}

interface SimulatedLedgerRow {
  txId: string;
  ruleId: string;
  sourcePath: string;
  destPath: string;
  sha256Hex: string;
  fileSizeBytes: number;
  status: 'COMMITTED' | 'ROLLED_BACK';
  createdAt: string;
  rolledBackAt?: string;
}

interface TraceEntry {
  id: string;
  timestamp: string;
  subsystem: 'FileWatcher' | 'SanctumDaemon' | 'RuleEngine' | 'LedgerManager';
  level: 'NOMINAL' | 'WARNING' | 'ERROR';
  message: string;
}

const SAMPLE_RULES = [
  {
    ruleId: 'rule_pdf_docs',
    name: 'PDF Documents',
    priority: 10,
    extensions: ['.pdf'],
    minSizeBytes: 0,
    destinationDir: '/Users/alex/Documents/PDFs',
  },
  {
    ruleId: 'rule_large_archives',
    name: 'Archives (>= 1 MB)',
    priority: 20,
    extensions: ['.zip', '.tar', '.gz'],
    minSizeBytes: 1_048_576,
    destinationDir: '/Users/alex/Archives',
  },
  {
    ruleId: 'rule_media_images',
    name: 'Design Assets',
    priority: 30,
    extensions: ['.png', '.jpg', '.svg'],
    minSizeBytes: 0,
    destinationDir: '/Users/alex/Pictures/Assets',
  },
];

const PRESET_EVENTS = [
  {
    label: 'Valid PDF (/Users/alex/Downloads/q4_audit.pdf)',
    path: '/Users/alex/Downloads/q4_audit.pdf',
    sizeBytes: 428_900,
    kind: 'MOVED_INTO' as const,
  },
  {
    label: 'Incomplete Chrome Download (report.pdf.crdownload)',
    path: '/Users/alex/Downloads/report.pdf.crdownload',
    sizeBytes: 120_400,
    kind: 'CREATED' as const,
  },
  {
    label: 'Temp File (installer_cache.tmp)',
    path: '/Users/alex/Downloads/installer_cache.tmp',
    sizeBytes: 8_192,
    kind: 'CREATED' as const,
  },
  {
    label: 'Protected POSIX Root (/etc/passwd)',
    path: '/etc/passwd',
    sizeBytes: 2_840,
    kind: 'CREATED' as const,
  },
  {
    label: 'Protected Windows System (C:\\Windows\\System32\\drivers.pdf)',
    path: 'C:\\Windows\\System32\\drivers.pdf',
    sizeBytes: 64_000,
    kind: 'CREATED' as const,
  },
  {
    label: 'Large Archive (/Users/alex/Downloads/dataset_v2.zip · 4.2 MB)',
    path: '/Users/alex/Downloads/dataset_v2.zip',
    sizeBytes: 4_404_019,
    kind: 'CREATED' as const,
  },
];

function deterministicShortHash(seed: string): string {
  let h1 = 0xdeadbeef ^ seed.length;
  let h2 = 0x41c6ce57 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    const ch = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (
    (h2 >>> 0).toString(16).padStart(8, '0') +
    (h1 >>> 0).toString(16).padStart(8, '0') +
    '9f4a2c81e0b7d316'
  );
}

function nowTimeStr(): string {
  return new Date().toISOString().slice(11, 23);
}

function checkProtectedSystemPath(rawPath: string): boolean {
  const normalized = rawPath.trim();
  if (normalized === '/' || /^[A-Za-z]:\\?$/.test(normalized)) {
    return true;
  }
  const posixBlocked = [
    '/bin',
    '/boot',
    '/dev',
    '/etc',
    '/lib',
    '/proc',
    '/root',
    '/run',
    '/sbin',
    '/sys',
    '/usr',
    '/var',
    '/System',
    '/Library',
  ];
  for (const prefix of posixBlocked) {
    if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
      return true;
    }
  }
  const winLower = normalized.toLowerCase();
  if (
    winLower.startsWith('c:\\windows') ||
    winLower.startsWith('c:\\program files')
  ) {
    return true;
  }
  return false;
}

function checkTemporaryArtifact(rawPath: string): string | null {
  const base = rawPath.split(/[/\\]/).pop() ?? '';
  const lower = base.toLowerCase();
  if (['.ds_store', 'thumbs.db', 'desktop.ini'].includes(lower)) {
    return 'Ignored OS metadata file';
  }
  if (lower.startsWith('~$') || lower.startsWith('.~lock.')) {
    return 'Ignored Office/editor lock prefix';
  }
  const ignoredExts = [
    '.tmp',
    '.crdownload',
    '.part',
    '.partial',
    '.download',
    '.sanctum_staging',
  ];
  for (const ext of ignoredExts) {
    if (lower.endsWith(ext)) {
      return `Ignored ephemeral extension (${ext})`;
    }
  }
  return null;
}

export const AtomicSimulator: React.FC = () => {
  const [selectedPresetIdx, setSelectedPresetIdx] = useState(0);
  const [customPath, setCustomPath] = useState('');
  const [injectDbFault, setInjectDbFault] = useState(false);

  const [virtualDisk, setVirtualDisk] = useState<SimulatedFile[]>([
    {
      path: '/Users/alex/Documents/PDFs/onboarding_guide.pdf',
      sizeBytes: 312_400,
      sha256: '7c9e6679742540de944b0e0fc19905a8',
    },
  ]);

  const [eventQueue, setEventQueue] = useState<QueuedEvent[]>([]);

  const [ledgerRows, setLedgerRows] = useState<SimulatedLedgerRow[]>([
    {
      txId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
      ruleId: 'rule_pdf_docs',
      sourcePath: '/Users/alex/Downloads/onboarding_guide.pdf',
      destPath: '/Users/alex/Documents/PDFs/onboarding_guide.pdf',
      sha256Hex: '7c9e6679742540de944b0e0fc19905a8',
      fileSizeBytes: 312_400,
      status: 'COMMITTED',
      createdAt: '09:14:02.118',
    },
  ]);

  const [traces, setTraces] = useState<TraceEntry[]>([
    {
      id: 'init-1',
      timestamp: '09:14:00.004',
      subsystem: 'LedgerManager',
      level: 'NOMINAL',
      message:
        'SQLite3 initialized with PRAGMA journal_mode=WAL, synchronous=NORMAL, busy_timeout=5000ms.',
    },
    {
      id: 'init-2',
      timestamp: '09:14:02.118',
      subsystem: 'LedgerManager',
      level: 'NOMINAL',
      message:
        'Committed tx 9b1deb4d: onboarding_guide.pdf -> /Users/alex/Documents/PDFs/onboarding_guide.pdf',
    },
  ]);

  const appendTrace = (
    subsystem: TraceEntry['subsystem'],
    level: TraceEntry['level'],
    message: string
  ) => {
    setTraces((prev) => [
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        timestamp: nowTimeStr(),
        subsystem,
        level,
        message,
      },
      ...prev.slice(0, 19),
    ]);
  };

  const dispatchCandidateEvent = (
    pathInput: string,
    sizeBytes: number,
    kind: 'CREATED' | 'MOVED_INTO'
  ) => {
    const cleanPath = pathInput.trim();
    if (!cleanPath) return;

    // 1. Simulate FileWatcher filtering
    const tempReason = checkTemporaryArtifact(cleanPath);
    if (tempReason) {
      appendTrace(
        'FileWatcher',
        'WARNING',
        `${tempReason}: dropped '${cleanPath}' before queue.put().`
      );
      return;
    }

    if (checkProtectedSystemPath(cleanPath)) {
      appendTrace(
        'FileWatcher',
        'ERROR',
        `Blocked protected OS system path '${cleanPath}' (is_protected_system_path == True).`
      );
      return;
    }

    // Materialize candidate file on simulated disk if not already present
    const sha256 = deterministicShortHash(`${cleanPath}:${sizeBytes}`);
    setVirtualDisk((prev) => {
      if (prev.some((f) => f.path === cleanPath)) return prev;
      return [...prev, { path: cleanPath, sizeBytes, sha256 }];
    });

    const eventId = Math.random().toString(16).slice(2, 10);
    setEventQueue((prev) => [
      ...prev,
      {
        eventId,
        path: cleanPath,
        kind,
        enqueuedAt: nowTimeStr(),
      },
    ]);

    appendTrace(
      'FileWatcher',
      'NOMINAL',
      `Passed path & suffix filters; enqueued FileEvent(${kind}, '${cleanPath}') [id=${eventId}].`
    );
  };

  const processNextQueuedEvent = () => {
    if (eventQueue.length === 0) return;

    const [nextEvent, ...remainingQueue] = eventQueue;
    setEventQueue(remainingQueue);

    const diskFile = virtualDisk.find((f) => f.path === nextEvent.path);
    if (!diskFile) {
      appendTrace(
        'SanctumDaemon',
        'WARNING',
        `Candidate vanished prior to worker evaluation: ${nextEvent.path} (task_done() finalized).`
      );
      return;
    }

    const filename = diskFile.path.split(/[/\\]/).pop() ?? '';
    const dotIndex = filename.lastIndexOf('.');
    const ext = dotIndex >= 0 ? filename.slice(dotIndex).toLowerCase() : '';
    const parentDir = diskFile.path.slice(
      0,
      Math.max(diskFile.path.lastIndexOf('/'), diskFile.path.lastIndexOf('\\'))
    );

    const matchedRule = SAMPLE_RULES.find((rule) => {
      if (parentDir === rule.destinationDir) return false;
      if (!rule.extensions.includes(ext)) return false;
      if (diskFile.sizeBytes < rule.minSizeBytes) return false;
      return true;
    });

    if (!matchedRule) {
      appendTrace(
        'RuleEngine',
        'WARNING',
        `No active Rule matched '${filename}' (${diskFile.sizeBytes.toLocaleString()} B); file left untouched.`
      );
      return;
    }

    const destPath = `${matchedRule.destinationDir}/${filename}`;
    if (virtualDisk.some((f) => f.path === destPath)) {
      appendTrace(
        'LedgerManager',
        'ERROR',
        `Aborted Phase 1: destination '${destPath}' already exists (never clobber invariant).`
      );
      return;
    }

    if (injectDbFault) {
      appendTrace(
        'LedgerManager',
        'ERROR',
        `Simulated SQLite OperationalError inside BEGIN IMMEDIATE! Compensating cleanup unlinked '${destPath}'; original '${diskFile.path}' preserved intact.`
      );
      return;
    }

    const txId = `${Math.random().toString(16).slice(2, 10)}-4f2a-9c1e-${Math.random()
      .toString(16)
      .slice(2, 14)
      .padEnd(12, '0')}`;

    // Atomic 3-Phase transition: copy -> WAL commit -> delete original
    setVirtualDisk((prev) =>
      prev
        .filter((f) => f.path !== diskFile.path)
        .concat({
          path: destPath,
          sizeBytes: diskFile.sizeBytes,
          sha256: diskFile.sha256,
        })
    );

    setLedgerRows((prev) => [
      {
        txId,
        ruleId: matchedRule.ruleId,
        sourcePath: diskFile.path,
        destPath,
        sha256Hex: diskFile.sha256,
        fileSizeBytes: diskFile.sizeBytes,
        status: 'COMMITTED',
        createdAt: nowTimeStr(),
      },
      ...prev,
    ]);

    appendTrace(
      'LedgerManager',
      'NOMINAL',
      `3-phase move committed [tx=${txId.slice(0, 8)}]: staged + fsynced -> WAL INSERT -> unlinked '${diskFile.path}'.`
    );
  };

  const handleRollback = (txId: string) => {
    const row = ledgerRows.find((r) => r.txId === txId);
    if (!row || row.status !== 'COMMITTED') return;

    const destFile = virtualDisk.find((f) => f.path === row.destPath);
    if (!destFile) {
      appendTrace(
        'LedgerManager',
        'ERROR',
        `Rollback aborted for ${txId.slice(0, 8)}: organized file missing at ${row.destPath}.`
      );
      return;
    }

    if (destFile.sha256 !== row.sha256Hex) {
      appendTrace(
        'LedgerManager',
        'ERROR',
        `Rollback aborted for ${txId.slice(0, 8)}: SHA-256 mismatch (file modified after organization).`
      );
      return;
    }

    if (virtualDisk.some((f) => f.path === row.sourcePath)) {
      appendTrace(
        'LedgerManager',
        'ERROR',
        `Rollback aborted for ${txId.slice(0, 8)}: original path '${row.sourcePath}' is already occupied.`
      );
      return;
    }

    const rolledBackAt = nowTimeStr();
    setVirtualDisk((prev) =>
      prev
        .filter((f) => f.path !== row.destPath)
        .concat({
          path: row.sourcePath,
          sizeBytes: row.fileSizeBytes,
          sha256: row.sha256Hex,
        })
    );

    setLedgerRows((prev) =>
      prev.map((item) =>
        item.txId === txId
          ? { ...item, status: 'ROLLED_BACK', rolledBackAt }
          : item
      )
    );

    appendTrace(
      'LedgerManager',
      'NOMINAL',
      `rollback('${txId.slice(0, 8)}') verified SHA-256, restored '${row.sourcePath}', updated WAL status=ROLLED_BACK, and unlinked destination.`
    );
  };

  const runLoopDetectionDemo = () => {
    appendTrace(
      'RuleEngine',
      'NOMINAL',
      'Invoked RuleEngine.detect_infinite_loops(rules, watched_dirs): placeholder returned [] (acyclic rule set).'
    );
  };

  return (
    <section id="atomic-simulator" className="scroll-mt-20">
      <div className="mb-6">
        <p className="text-xs font-medium text-teal-700 mb-1">
          04. Interactive Engine Verification Bench
        </p>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
          Queue, Filter & Atomic Rollback Simulator
        </h2>
        <p className="text-sm text-slate-600 mt-1 max-w-3xl">
          Exercise the background engine pipeline directly: test Watchdog root/temp-file rejection, step the <code className="font-mono text-xs text-slate-800">SanctumDaemon</code> worker queue, inject Phase 2 SQLite failures, and execute <code className="font-mono text-xs text-slate-800">rollback(tx_id)</code>.
        </p>
      </div>

      {/* Control Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 mb-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-end">
          {/* Preset Event Dispatcher */}
          <div className="lg:col-span-5">
            <label
              htmlFor="preset-event-select"
              className="block text-xs font-semibold text-slate-800 mb-2"
            >
              1. Dispatch Preset Filesystem Event to FileWatcher
            </label>
            <div className="flex items-center gap-2">
              <select
                id="preset-event-select"
                value={selectedPresetIdx}
                onChange={(e) => setSelectedPresetIdx(Number(e.target.value))}
                className="w-full h-10 px-3 text-xs font-mono bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
              >
                {PRESET_EVENTS.map((preset, idx) => (
                  <option key={preset.path} value={idx}>
                    {preset.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  const p = PRESET_EVENTS[selectedPresetIdx];
                  dispatchCandidateEvent(p.path, p.sizeBytes, p.kind);
                }}
                className="h-10 px-4 inline-flex items-center gap-1.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Emit Event</span>
              </button>
            </div>
          </div>

          {/* Custom Path Input */}
          <div className="lg:col-span-4">
            <label
              htmlFor="custom-path-input"
              className="block text-xs font-semibold text-slate-800 mb-2"
            >
              Or Test Custom Path (e.g. /root/key.pdf or ~/Downloads/spec.pdf)
            </label>
            <div className="flex items-center gap-2">
              <input
                id="custom-path-input"
                type="text"
                value={customPath}
                onChange={(e) => setCustomPath(e.target.value)}
                placeholder="/Users/alex/Downloads/architecture.pdf"
                className="w-full h-10 px-3 text-xs font-mono bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
              <button
                type="button"
                onClick={() => {
                  if (!customPath.trim()) return;
                  dispatchCandidateEvent(customPath, 2_097_152, 'CREATED');
                  setCustomPath('');
                }}
                className="h-10 px-3.5 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Push Custom
              </button>
            </div>
          </div>

          {/* Worker Queue Consumer + Fault Toggle */}
          <div className="lg:col-span-3 flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs text-slate-600">
              <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={injectDbFault}
                  onChange={(e) => setInjectDbFault(e.target.checked)}
                  className="rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                />
                <span className="font-medium text-slate-700">
                  Simulate Phase 2 DB Failure
                </span>
              </label>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={eventQueue.length === 0}
                onClick={processNextQueuedEvent}
                className="flex-1 h-10 px-4 inline-flex items-center justify-center gap-1.5 text-xs font-medium text-white bg-teal-700 hover:bg-teal-600 disabled:bg-slate-200 disabled:text-slate-400 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:cursor-not-allowed"
              >
                <Play className="w-3.5 h-3.5" />
                <span className="tabular-nums">
                  Drain Next ({eventQueue.length} in Queue)
                </span>
              </button>

              <button
                type="button"
                onClick={runLoopDetectionDemo}
                title="Invoke RuleEngine.detect_infinite_loops()"
                className="h-10 px-3 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Check Loops
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* SQLite WAL Ledger Table + Subsystem Execution Trace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* SQLite WAL Ledger Table */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                SQLite3 WAL Ledger (file_transactions)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
                {ledgerRows.length} recorded transactions · {virtualDisk.length} files on simulated disk
              </p>
            </div>
          </div>

          {ledgerRows.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500">
              No transactions committed yet. Emit a valid file event above and drain the daemon queue.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                    <th className="py-2.5 px-4 whitespace-nowrap">tx_id</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Transition (Source → Dest)</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">State</th>
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {ledgerRows.map((row) => (
                    <tr key={row.txId} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-3 px-4 font-mono text-slate-700 tabular-nums whitespace-nowrap align-top">
                        <div>{row.txId.slice(0, 8)}…</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {row.createdAt}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-800 align-top">
                        <div className="text-slate-500 break-all">{row.sourcePath}</div>
                        <div className="text-slate-900 font-medium mt-0.5 break-all">
                          → {row.destPath}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                          sha256:{row.sha256Hex.slice(0, 12)} · {row.ruleId}
                        </div>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap align-top">
                        {row.status === 'COMMITTED' ? (
                          <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            <span>Committed</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 font-medium text-amber-700">
                            <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                            <span>Rolled Back</span>
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap align-top">
                        {row.status === 'COMMITTED' ? (
                          <button
                            type="button"
                            onClick={() => handleRollback(row.txId)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-800 border border-slate-300 hover:bg-slate-100 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>Rollback</span>
                          </button>
                        ) : (
                          <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                            {row.rolledBackAt}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right: Subsystem Event Trace */}
        <div className="lg:col-span-5 bg-slate-950 text-slate-100 border border-slate-900 rounded-xl overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-slate-800 bg-slate-900 flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">
                Daemon Thread & Filter Log
              </h3>
              <p className="text-xs text-slate-400 mt-0.5 tabular-nums">
                Queue depth: {eventQueue.length} / 4096 maxsize
              </p>
            </div>
            <button
              type="button"
              onClick={() => setTraces([])}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear</span>
            </button>
          </div>

          <div className="p-4 space-y-3 overflow-y-auto max-h-[380px] font-mono text-xs">
            {traces.length === 0 ? (
              <div className="text-slate-500 py-8 text-center">
                Log cleared. Dispatch an event to trace subsystem behavior.
              </div>
            ) : (
              traces.map((entry) => (
                <div
                  key={entry.id}
                  className="pb-3 border-b border-slate-800/80 last:border-b-0 last:pb-0"
                >
                  <div className="flex items-center gap-2 text-[11px] text-slate-400 tabular-nums mb-1">
                    <span>{entry.timestamp}</span>
                    <span aria-hidden="true">·</span>
                    <span className="text-slate-200 font-semibold">
                      {entry.subsystem}
                    </span>
                    <span aria-hidden="true">·</span>
                    {entry.level === 'NOMINAL' && (
                      <span className="inline-flex items-center gap-1 text-emerald-400">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>OK</span>
                      </span>
                    )}
                    {entry.level === 'WARNING' && (
                      <span className="inline-flex items-center gap-1 text-amber-300">
                        <AlertTriangle className="w-3 h-3" />
                        <span>FILTERED</span>
                      </span>
                    )}
                    {entry.level === 'ERROR' && (
                      <span className="inline-flex items-center gap-1 text-rose-400">
                        <ShieldAlert className="w-3 h-3" />
                        <span>BLOCKED / ABORTED</span>
                      </span>
                    )}
                  </div>
                  <p className="text-slate-300 leading-relaxed break-words">
                    {entry.message}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
