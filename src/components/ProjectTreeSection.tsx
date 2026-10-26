import React, { useState } from 'react';
import { Check, Copy, ArrowUpRight } from 'lucide-react';
import { BLUEPRINT_FILES, PROJECT_TREE_ASCII } from '../data/projectBlueprint';

interface ProjectTreeSectionProps {
  onOpenFile: (fileId: string) => void;
}

const DIRECTORY_RESPONSIBILITIES = [
  {
    path: 'pyproject.toml & requirements.txt',
    layer: 'Packaging & Static Verification',
    fileId: 'pyproject.toml',
    rationale:
      'Adopts PEP 621 src-layout packaging so pytest and PyQt6 entrypoints always import the installed package rather than accidental working-directory shadowing.',
  },
  {
    path: 'src/sanctum_keeper/core/daemon.py',
    layer: 'Orchestrator (SanctumDaemon)',
    fileId: 'daemon.py',
    rationale:
      'Owns the bounded queue.Queue, manages startup/shutdown ordering (stop producer -> drain -> None sentinel -> close SQLite handle), and isolates per-event exceptions.',
  },
  {
    path: 'src/sanctum_keeper/core/watcher.py',
    layer: 'Producer (FileWatcher)',
    fileId: 'watcher.py',
    rationale:
      'Wraps watchdog.observers.Observer, rejects OS root directories (/ , C:\\, /etc, C:\\Windows), filters .tmp/.crdownload artifacts, and suppresses self-triggered moves.',
  },
  {
    path: 'src/sanctum_keeper/core/rules.py',
    layer: 'Evaluator (RuleEngine)',
    fileId: 'rules.py',
    rationale:
      'Evaluates frozen Rule predicates in deterministic (priority, rule_id) order and enforces the detect_infinite_loops() static graph boundary.',
  },
  {
    path: 'src/sanctum_keeper/core/ledger.py',
    layer: 'Persistence (LedgerManager)',
    fileId: 'ledger.py',
    rationale:
      'Configures SQLite3 WAL mode with BEGIN IMMEDIATE transactions, performs verified staged copies + fsync prior to DB commits, and exposes rollback(tx_id).',
  },
  {
    path: 'src/sanctum_keeper/ui/',
    layer: 'Presentation Boundary (Deferred PyQt6)',
    fileId: 'main.py',
    rationale:
      'Strictly decoupled from core/. Future PyQt6 QThread/signals will subscribe to SanctumDaemon and read WAL snapshots concurrently without blocking file moves.',
  },
];

export const ProjectTreeSection: React.FC<ProjectTreeSectionProps> = ({
  onOpenFile,
}) => {
  const [copiedTree, setCopiedTree] = useState(false);

  const handleCopyTree = async () => {
    await navigator.clipboard.writeText(PROJECT_TREE_ASCII);
    setCopiedTree(true);
    window.setTimeout(() => setCopiedTree(false), 1800);
  };

  return (
    <section id="project-tree" className="scroll-mt-20">
      <div className="mb-6">
        <p className="text-xs font-medium text-teal-700 mb-1">
          02. Repository Layout
        </p>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
          Standard Python 3.10+ Directory Tree
        </h2>
        <p className="text-sm text-slate-600 mt-1 max-w-2xl">
          Uses the modern <code className="font-mono text-xs text-slate-800">src/sanctum_keeper/</code> layout to isolate the deterministic background engine from the upcoming PyQt6 desktop layer and test suite.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left: Canonical Folder Tree */}
        <div className="lg:col-span-6 bg-slate-950 text-slate-100 rounded-xl border border-slate-900 flex flex-col justify-between overflow-hidden">
          <div>
            <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-b border-slate-800 bg-slate-900">
              <div className="flex items-center gap-2 text-xs text-slate-300 font-mono">
                <span>sanctum_keeper/</span>
                <span aria-hidden="true">·</span>
                <span>src-layout</span>
              </div>
              <button
                type="button"
                onClick={handleCopyTree}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {copiedTree ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Copied Tree</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Tree</span>
                  </>
                )}
              </button>
            </div>
            <pre className="p-5 text-xs sm:text-[13px] leading-6 font-mono text-slate-200 overflow-x-auto">
              {PROJECT_TREE_ASCII}
            </pre>
          </div>

          <div className="px-5 py-3.5 border-t border-slate-800 bg-slate-900/60 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
            <span>All 9 scaffolded files are also written to /sanctum_keeper in this workspace</span>
            <span className="font-mono tabular-nums text-slate-300">
              {BLUEPRINT_FILES.length} source files ready
            </span>
          </div>
        </div>

        {/* Right: Architectural Boundary Table */}
        <div className="lg:col-span-6 bg-white rounded-xl border border-slate-200 divide-y divide-slate-200 flex flex-col justify-between">
          {DIRECTORY_RESPONSIBILITIES.map((item) => (
            <div
              key={item.path}
              className="p-5 flex flex-col justify-between gap-2 hover:bg-slate-50/70 transition-colors"
            >
              <div className="flex items-baseline justify-between gap-4">
                <div className="min-w-0">
                  <span className="font-mono text-xs font-semibold text-slate-900 break-all">
                    {item.path}
                  </span>
                  <span className="mx-2 text-slate-300" aria-hidden="true">
                    ·
                  </span>
                  <span className="text-xs text-teal-700 font-medium">
                    {item.layer}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onOpenFile(item.fileId);
                    document
                      .getElementById('source-modules')
                      ?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-teal-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <span>Inspect</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                {item.rationale}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
