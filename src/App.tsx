/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { Download, FileCode2 } from 'lucide-react';
import { BLUEPRINT_FILES } from './data/projectBlueprint';
import { CodeInspector } from './components/CodeInspector';
import { ProjectTreeSection } from './components/ProjectTreeSection';
import { ArchitectureSpecSection } from './components/ArchitectureSpecSection';
import { AtomicSimulator } from './components/AtomicSimulator';
import { buildProjectBootstrapScript, downloadTextFile } from './utils/exportRepo';

export default function App() {
  const [selectedFileId, setSelectedFileId] = useState<string>('daemon.py');

  const handleExportRepo = () => {
    const script = buildProjectBootstrapScript();
    downloadTextFile('setup_sanctum_keeper.sh', script);
  };

  const jumpToModule = (fileId: string) => {
    setSelectedFileId(fileId);
    document
      .getElementById('source-modules')
      ?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-xs border-b border-slate-200">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-8 px-6 py-3.5">
          {/* Zone 1: Single-line Brand Wordmark */}
          <a
            href="#"
            className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            Sanctum Keeper
          </a>

          {/* Zone 2: 4 Single-line Navigation Links */}
          <nav
            aria-label="Primary architecture sections"
            className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600"
          >
            <a
              href="#source-modules"
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Source Modules
            </a>
            <a
              href="#project-tree"
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Project Tree
            </a>
            <a
              href="#architecture-spec"
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Architecture
            </a>
            <a
              href="#atomic-simulator"
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Simulator
            </a>
          </nav>

          {/* Zone 3: 1 Primary Action */}
          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={handleExportRepo}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-600 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Python Repo</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-10 space-y-16">
        {/* Hero Architectural Brief */}
        <section className="pb-10 border-b border-slate-200">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mb-3">
            <span>Python 3.10+</span>
            <span aria-hidden="true">·</span>
            <span>Watchdog Filesystem Observer</span>
            <span aria-hidden="true">·</span>
            <span>SQLite3 WAL Mode</span>
            <span aria-hidden="true">·</span>
            <span>Headless Engine Blueprint (PyQt6 Deferred)</span>
          </div>

          <h1
            className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 max-w-3xl leading-tight"
            style={{ textWrap: 'balance' }}
          >
            Deterministic, Offline File-Organization Daemon Architecture
          </h1>

          <p className="mt-4 text-base text-slate-600 max-w-3xl leading-relaxed">
            Complete <code className="font-mono text-sm text-slate-800">src/</code>-layout scaffold and modular Python 3.10+ implementation for{' '}
            <strong className="font-semibold text-slate-800">Sanctum Keeper</strong>. Engineered around a bounded thread-safe{' '}
            <code className="font-mono text-sm text-slate-800">queue.Queue</code>, OS root &amp; ephemeral download guards, loop-aware rule evaluation, and three-phase WAL-committed atomic moves with cryptographic{' '}
            <code className="font-mono text-sm text-slate-800">rollback(tx_id)</code>.
          </p>

          {/* Quick Jump Buttons for Primary Deliverables */}
          <div className="mt-6 flex flex-wrap items-center gap-2.5">
            {(['daemon.py', 'ledger.py', 'watcher.py', 'rules.py'] as const).map(
              (fileId) => (
                <button
                  key={fileId}
                  type="button"
                  onClick={() => jumpToModule(fileId)}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-mono font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    selectedFileId === fileId
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-800 border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  <FileCode2 className="w-3.5 h-3.5" />
                  <span>{fileId}</span>
                </button>
              )
            )}
          </div>

          {/* 4-Column Architectural Summary Strip */}
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-slate-200 border border-slate-200 rounded-xl overflow-hidden">
            <div className="bg-white p-5">
              <div className="text-xs font-semibold text-slate-900">
                SanctumDaemon
              </div>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                Bounded <code className="font-mono">queue.Queue(4096)</code> consumer loop with per-item fault isolation and poison-pill shutdown.
              </p>
            </div>
            <div className="bg-white p-5">
              <div className="text-xs font-semibold text-slate-900">
                FileWatcher
              </div>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                Blocks POSIX/Windows OS roots, filters <code className="font-mono">.tmp</code> &amp; <code className="font-mono">.crdownload</code>, and suppresses self-induced moves.
              </p>
            </div>
            <div className="bg-white p-5">
              <div className="text-xs font-semibold text-slate-900">
                RuleEngine
              </div>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                Frozen <code className="font-mono">slots=True</code> rules sorted by <code className="font-mono">(priority, rule_id)</code> plus <code className="font-mono">detect_infinite_loops</code> boundary.
              </p>
            </div>
            <div className="bg-white p-5">
              <div className="text-xs font-semibold text-slate-900">
                LedgerManager
              </div>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                SQLite3 WAL + <code className="font-mono">BEGIN IMMEDIATE</code>; stages &amp; fsyncs copies before DB commit and verifies SHA-256 on rollback.
              </p>
            </div>
          </div>
        </section>

        {/* Deliverable 1: Modular Source Code Inspector */}
        <CodeInspector
          files={BLUEPRINT_FILES}
          selectedFileId={selectedFileId}
          onSelectFile={setSelectedFileId}
        />

        {/* Deliverable 2: Standard Python Project Tree */}
        <ProjectTreeSection onOpenFile={setSelectedFileId} />

        {/* Deliverable 3: Concurrency & Atomic Safety Specification */}
        <ArchitectureSpecSection />

        {/* Deliverable 4: Interactive Concurrency & Rollback Simulator */}
        <AtomicSimulator />
      </main>

      {/* Clean Quiet Footer */}
      <footer className="border-t border-slate-200 bg-white mt-16">
        <div className="max-w-7xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div>
            Sanctum Keeper Background Engine Blueprint · Python 3.10+ Standard Library &amp; Watchdog
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={handleExportRepo}
              className="text-slate-700 hover:text-teal-700 font-medium transition-colors cursor-pointer"
            >
              Download setup_sanctum_keeper.sh
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
