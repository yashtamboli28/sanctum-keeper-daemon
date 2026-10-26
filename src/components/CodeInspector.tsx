import React, { useState, useMemo } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import { BlueprintFile } from '../data/projectBlueprint';
import { downloadTextFile } from '../utils/exportRepo';

interface CodeInspectorProps {
  files: BlueprintFile[];
  selectedFileId: string;
  onSelectFile: (id: string) => void;
}

const PYTHON_KEYWORDS = new Set([
  'from', 'import', 'class', 'def', 'return', 'if', 'elif', 'else', 'for',
  'while', 'in', 'not', 'and', 'or', 'is', 'None', 'True', 'False', 'try',
  'except', 'finally', 'raise', 'with', 'as', 'pass', 'break', 'continue',
  'yield', 'lambda', 'assert',
]);

function renderPythonLine(line: string): React.ReactNode {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('#')) {
    return <span className="text-slate-400 italic">{line}</span>;
  }
  if (trimmed.startsWith('@')) {
    return <span className="text-amber-300">{line}</span>;
  }
  if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
    return <span className="text-emerald-300/90">{line}</span>;
  }

  // Split comments outside obvious quotes for clean inline comment tinting
  const tokenRegex = /("[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'|\b[A-Za-z_][A-Za-z0-9_]*\b|\b\d+(?:\.\d+)?\b|#.*$)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      parts.push(line.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('#')) {
      parts.push(
        <span key={match.index} className="text-slate-400 italic">
          {token}
        </span>
      );
    } else if (token.startsWith('"') || token.startsWith("'")) {
      parts.push(
        <span key={match.index} className="text-emerald-300">
          {token}
        </span>
      );
    } else if (PYTHON_KEYWORDS.has(token)) {
      parts.push(
        <span key={match.index} className="text-sky-300 font-medium">
          {token}
        </span>
      );
    } else if (/^\d/.test(token)) {
      parts.push(
        <span key={match.index} className="text-amber-200">
          {token}
        </span>
      );
    } else if (/^[A-Z][A-Za-z0-9_]+$/.test(token)) {
      parts.push(
        <span key={match.index} className="text-teal-200">
          {token}
        </span>
      );
    } else {
      parts.push(token);
    }
    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < line.length) {
    parts.push(line.slice(lastIndex));
  }

  return parts;
}

export const CodeInspector: React.FC<CodeInspectorProps> = ({
  files,
  selectedFileId,
  onSelectFile,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');

  const activeFile = useMemo(
    () => files.find((f) => f.id === selectedFileId) ?? files[0],
    [files, selectedFileId]
  );

  const visibleFiles = useMemo(() => {
    if (categoryFilter === 'ALL') return files;
    return files.filter((f) => f.category === categoryFilter);
  }, [files, categoryFilter]);

  const codeLines = useMemo(
    () => activeFile.content.replace(/\n$/, '').split('\n'),
    [activeFile.content]
  );

  const byteCount = useMemo(
    () => new TextEncoder().encode(activeFile.content).length,
    [activeFile.content]
  );

  const handleCopy = async () => {
    await navigator.clipboard.writeText(activeFile.content);
    setCopiedId(activeFile.id);
    window.setTimeout(() => setCopiedId(null), 1800);
  };

  return (
    <section id="source-modules" className="scroll-mt-20">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
        <div>
          <p className="text-xs font-medium text-teal-700 mb-1">
            01. Modular Python 3.10+ Boilerplate
          </p>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
            Core Engine Source Modules
          </h2>
          <p className="text-sm text-slate-600 mt-1 max-w-2xl">
            Thread-safe background daemon modules focused on bounded producer-consumer queues, Watchdog path filtering, and WAL-backed three-phase atomic file transactions.
          </p>
        </div>

        {/* Interactive segmented filter control */}
        <div
          role="tablist"
          aria-label="Filter modules by category"
          className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start"
        >
          {[
            { key: 'ALL', label: 'All Files' },
            { key: 'Core Deliverable', label: 'Core Deliverables' },
            { key: 'Supporting Engine', label: 'Engine Models' },
            { key: 'Project Config & Tests', label: 'Config & Pytest' },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={categoryFilter === tab.key}
              onClick={() => {
                setCategoryFilter(tab.key);
                const matching =
                  tab.key === 'ALL'
                    ? files
                    : files.filter((f) => f.category === tab.key);
                if (matching.length > 0 && !matching.some((m) => m.id === activeFile.id)) {
                  onSelectFile(matching[0].id);
                }
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                categoryFilter === tab.key
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Single-elevation container splitting module list & source pane */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden grid grid-cols-1 lg:grid-cols-12">
        {/* Left File Selector Sidebar */}
        <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col justify-between bg-slate-50/60">
          <div className="divide-y divide-slate-200/80">
            {visibleFiles.map((file) => {
              const isSelected = file.id === activeFile.id;
              const lineTotal = file.content.replace(/\n$/, '').split('\n').length;
              return (
                <button
                  key={file.id}
                  type="button"
                  onClick={() => onSelectFile(file.id)}
                  className={`w-full text-left px-5 py-4 transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-white text-slate-900'
                      : 'hover:bg-white/70 text-slate-700'
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span
                      className={`font-mono text-sm font-semibold truncate ${
                        isSelected ? 'text-teal-700' : 'text-slate-900'
                      }`}
                    >
                      {file.name}
                    </span>
                    <span className="font-mono text-xs text-slate-400 tabular-nums whitespace-nowrap shrink-0">
                      {lineTotal} lines
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500 truncate">
                    <span>{file.subsystem}</span>
                    <span aria-hidden="true">·</span>
                    <span>{file.category}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Active file concurrency & safety invariants */}
          <div className="p-5 border-t border-slate-200 bg-slate-50">
            <h3 className="text-xs font-semibold text-slate-900 mb-2.5">
              Enforced Safety Invariants ({activeFile.name})
            </h3>
            <ul className="space-y-2 text-xs text-slate-600 leading-relaxed">
              {activeFile.invariants.map((inv, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="font-mono text-teal-700 tabular-nums shrink-0">
                    0{idx + 1}.
                  </span>
                  <span>{inv}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Right Code Viewer Pane */}
        <div className="lg:col-span-8 flex flex-col min-w-0 bg-slate-950 text-slate-100">
          {/* Code Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-3.5 border-b border-slate-800 bg-slate-900">
            <div className="min-w-0">
              <div className="font-mono text-xs text-slate-200 truncate">
                sanctum_keeper/{activeFile.relativePath}
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5 tabular-nums">
                <span>Python 3.10+</span>
                <span aria-hidden="true">·</span>
                <span>{codeLines.length} lines</span>
                <span aria-hidden="true">·</span>
                <span>{(byteCount / 1024).toFixed(1)} KB</span>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {copiedId === activeFile.id ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Code</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => downloadTextFile(activeFile.name, activeFile.content)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-teal-700 hover:bg-teal-600 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download {activeFile.name}</span>
              </button>
            </div>
          </div>

          {/* Module Architectural Summary Bar */}
          <div className="px-5 py-3 border-b border-slate-800/80 bg-slate-900/50 text-xs text-slate-300 leading-relaxed">
            {activeFile.summary}
          </div>

          {/* Scrollable Monospace Source View */}
          <div className="overflow-x-auto overflow-y-auto max-h-[680px] py-4 text-[13px] leading-6 font-mono">
            <table className="w-full border-collapse">
              <tbody>
                {codeLines.map((line, index) => (
                  <tr
                    key={index}
                    className="hover:bg-slate-900/80 transition-colors"
                  >
                    <td className="select-none text-right pr-4 pl-5 text-slate-600 tabular-nums w-14 align-top">
                      {index + 1}
                    </td>
                    <td className="pr-6 whitespace-pre text-slate-100 tracking-wide">
                      {activeFile.language === 'python'
                        ? renderPythonLine(line)
                        : line}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
};
