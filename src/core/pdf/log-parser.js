/**
 * LaTeX log parsing.
 *
 * latexmk is run with -file-line-error, so most errors arrive as
 * `path/file.tex:12: message`. The remaining shapes (`! LaTeX Error:`,
 * `! Undefined control sequence`, missing files, warnings, over/underfull
 * boxes) are matched separately.
 */

const FILE_LINE_ERROR = /^(?<file>[^\s:][^:]*):(?<line>\d+):\s*(?<message>.+)$/;

export function parseLatexLog(log) {
  const errors = [];
  const warnings = [];
  const missingPackages = new Set();
  const missingFiles = new Set();
  // Characters the chosen font could not draw. TeX reports each one and carries
  // on, so a document in a script the font does not cover compiles "successfully"
  // to a page with nothing on it. Collected here so the caller can refuse it.
  const missingCharacters = new Map();
  const lines = String(log || '').split(/\r?\n/);

  const pushError = (entry) => {
    // Deduplicate: latexmk reruns replay the same diagnostics several times.
    const key = `${entry.file || ''}:${entry.line || ''}:${entry.message}`;
    if (!errors.some(e => `${e.file || ''}:${e.line || ''}:${e.message}` === key)) errors.push(entry);
  };
  const pushWarning = (entry) => {
    const key = `${entry.file || ''}:${entry.line || ''}:${entry.message}`;
    if (!warnings.some(w => `${w.file || ''}:${w.line || ''}:${w.message}` === key)) warnings.push(entry);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    // `! LaTeX Error: ...` / `! Undefined control sequence.` — the detail often
    // continues on following lines up to the `l.<n>` context marker.
    if (line.startsWith('!')) {
      const message = line.replace(/^!\s*/, '').trim();
      let contextLine = null;
      for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
        const m = lines[j].match(/^l\.(\d+)\s?(.*)$/);
        if (m) { contextLine = { line: Number(m[1]), context: m[2] }; break; }
      }
      pushError({
        severity: 'error',
        file: null,
        line: contextLine?.line ?? null,
        message,
        context: contextLine?.context || null,
      });
      continue;
    }

    // `file.tex:12: Undefined control sequence`
    const fl = line.match(FILE_LINE_ERROR);
    if (fl && /error|undefined|missing|runaway|emergency|not found|too many|extra |illegal/i.test(fl.groups.message)) {
      pushError({
        severity: 'error',
        file: fl.groups.file,
        line: Number(fl.groups.line),
        message: fl.groups.message.trim(),
      });
      continue;
    }

    // `Missing character: There is no 中 (U+4E2D) in font [lmroman10-regular]...`
    const missingChar = line.match(/^Missing character: There is no (.+?) \(U\+([0-9A-Fa-f]+)\) in font ([^!]*?)!?$/);
    if (missingChar) {
      const font = missingChar[3].trim().replace(/:.*$/, '');
      const entry = missingCharacters.get(font) || { font, count: 0, samples: [] };
      entry.count++;
      if (entry.samples.length < 8 && !entry.samples.includes(missingChar[1])) {
        entry.samples.push(missingChar[1]);
      }
      missingCharacters.set(font, entry);
      continue;
    }

    // Missing style/class files.
    const missingPkg = line.match(/File `([^']+)' not found/)
      || line.match(/LaTeX Error: File `([^']+)' not found/);
    if (missingPkg) {
      const name = missingPkg[1];
      if (/\.(sty|cls)$/.test(name)) missingPackages.add(name.replace(/\.(sty|cls)$/, ''));
      else missingFiles.add(name);
      pushError({ severity: 'error', file: null, line: null, message: `File not found: ${name}` });
      continue;
    }

    if (/^!\s*Emergency stop/.test(line) || /Fatal error occurred/.test(line)) {
      pushError({ severity: 'error', file: null, line: null, message: line.trim() });
      continue;
    }

    // Warnings.
    const warnMatch = line.match(/^(?:(?:LaTeX|Package|Class)\s+)?(?:([\w@-]+)\s+)?Warning:\s*(.+)$/);
    if (warnMatch && /Warning:/.test(line)) {
      let message = warnMatch[2].trim();
      // Warnings wrap; pull in the continuation lines.
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        if (/^\(?[\w@-]*\)?\s{2,}\S/.test(lines[j]) && !/Warning:|Error:/.test(lines[j])) {
          message += ' ' + lines[j].trim().replace(/^\([\w@-]+\)\s*/, '');
        } else break;
      }
      pushWarning({
        severity: 'warning',
        source: warnMatch[1] || 'LaTeX',
        file: null,
        line: extractWarningLine(message),
        message,
      });
      continue;
    }

    // Over/underfull boxes — noisy, so they are collected but marked as such.
    const box = line.match(/^(Overfull|Underfull)\s+\\([hv])box\s+\((.+?)\)(?:.*?at lines? (\d+))?/);
    if (box) {
      pushWarning({
        severity: 'info',
        source: 'layout',
        file: null,
        line: box[4] ? Number(box[4]) : null,
        message: `${box[1]} \\${box[2]}box (${box[3]})`,
      });
      continue;
    }
  }

  return {
    errors,
    warnings: warnings.filter(w => w.severity === 'warning'),
    layoutNotes: warnings.filter(w => w.severity === 'info'),
    missingPackages: [...missingPackages],
    missingFiles: [...missingFiles],
    missingCharacters: [...missingCharacters.values()],
  };
}

function extractWarningLine(message) {
  const m = message.match(/on input line (\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * Detect latexmk's own progress markers so the UI can show which pass is running.
 * Returns null for lines that carry no progress information.
 */
export function parseLatexmkProgress(line) {
  let m = line.match(/^Latexmk:\s*Run number (\d+) of rule '([^']+)'/);
  if (m) return { kind: 'pass', run: Number(m[1]), rule: m[2] };

  m = line.match(/^Latexmk:\s*applying rule '([^']+)'/);
  if (m) return { kind: 'rule', rule: m[1] };

  if (/^Latexmk:\s*All targets .* are up-to-date/.test(line)) return { kind: 'uptodate' };
  if (/^Latexmk:\s*Nothing to do/.test(line)) return { kind: 'uptodate' };
  if (/^Latexmk:\s*Errors, so I did not complete making targets/.test(line)) return { kind: 'failed' };

  return null;
}
