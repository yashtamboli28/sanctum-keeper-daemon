import { BLUEPRINT_FILES } from '../data/projectBlueprint';

/**
 * Generates a self-contained POSIX setup script that materializes the complete
 * Python 3.10+ `sanctum_keeper/` project tree and exact source files on disk.
 */
export function buildProjectBootstrapScript(): string {
  const lines: string[] = [
    '#!/usr/bin/env bash',
    '# Sanctum Keeper — Complete Python 3.10+ Project Bootstrapper',
    '# Usage: bash setup_sanctum_keeper.sh',
    'set -euo pipefail',
    '',
    'ROOT_DIR="sanctum_keeper"',
    'mkdir -p "$ROOT_DIR/src/sanctum_keeper/core"',
    'mkdir -p "$ROOT_DIR/src/sanctum_keeper/models"',
    'mkdir -p "$ROOT_DIR/src/sanctum_keeper/ui"',
    'mkdir -p "$ROOT_DIR/tests"',
    '',
    'cat << \'SANCTUM_EOF\' > "$ROOT_DIR/src/sanctum_keeper/__init__.py"',
    '"""Sanctum Keeper — Deterministic, offline file-organization daemon."""',
    '__all__ = ["__version__"]',
    '__version__ = "0.1.0"',
    'SANCTUM_EOF',
    '',
    'touch "$ROOT_DIR/src/sanctum_keeper/core/__init__.py"',
    'touch "$ROOT_DIR/src/sanctum_keeper/models/__init__.py"',
    'touch "$ROOT_DIR/src/sanctum_keeper/ui/__init__.py"',
    '',
  ];

  for (const file of BLUEPRINT_FILES) {
    lines.push(`cat << 'SANCTUM_EOF' > "$ROOT_DIR/${file.relativePath}"`);
    lines.push(file.content.trimEnd());
    lines.push('SANCTUM_EOF');
    lines.push('');
  }

  lines.push('echo "Sanctum Keeper Python 3.10+ scaffold created in ./$ROOT_DIR"');
  return lines.join('\n');
}

export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
