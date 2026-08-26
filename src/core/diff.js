/**
 * Line-oriented diffing, used to show the user exactly what an AI edit would
 * change before it is applied.
 *
 * Implemented directly rather than pulled from npm: the algorithm is small,
 * the output format is stable, and MDTeX must not gain a dependency for it.
 */

/** Longest-common-subsequence table over two line arrays. */
function lcsMatrix(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  // Uint32Array keeps a large file diff out of the slow path.
  const table = new Uint32Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * cols + j] = a[i] === b[j]
        ? table[(i + 1) * cols + (j + 1)] + 1
        : Math.max(table[(i + 1) * cols + j], table[i * cols + (j + 1)]);
    }
  }
  return { table, cols };
}

/**
 * Diff two texts into operations.
 * Returns [{ type: 'equal'|'insert'|'delete', line, oldIndex, newIndex }]
 */
export function diffLines(oldText, newText) {
  const a = String(oldText ?? '').split('\n');
  const b = String(newText ?? '').split('\n');

  // Fast path: identical, or one side empty.
  if (oldText === newText) {
    return a.map((line, i) => ({ type: 'equal', line, oldIndex: i, newIndex: i }));
  }

  const { table, cols } = lcsMatrix(a, b);
  const ops = [];
  let i = 0;
  let j = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ type: 'equal', line: a[i], oldIndex: i, newIndex: j });
      i++; j++;
    } else if (table[(i + 1) * cols + j] >= table[i * cols + (j + 1)]) {
      ops.push({ type: 'delete', line: a[i], oldIndex: i, newIndex: null });
      i++;
    } else {
      ops.push({ type: 'insert', line: b[j], oldIndex: null, newIndex: j });
      j++;
    }
  }
  while (i < a.length) ops.push({ type: 'delete', line: a[i], oldIndex: i++, newIndex: null });
  while (j < b.length) ops.push({ type: 'insert', line: b[j], oldIndex: null, newIndex: j++ });

  return ops;
}

/** Summary counts for a diff. */
export function diffStats(oldText, newText) {
  let added = 0;
  let removed = 0;
  for (const op of diffLines(oldText, newText)) {
    if (op.type === 'insert') added++;
    else if (op.type === 'delete') removed++;
  }
  return { added, removed, changed: added + removed };
}

/**
 * Unified diff text, the format everyone already knows how to read.
 */
export function unifiedDiff(oldText, newText, { fromFile = 'before', toFile = 'after', context = 3 } = {}) {
  const ops = diffLines(oldText, newText);
  if (!ops.some(op => op.type !== 'equal')) return '';

  // Group ops into hunks separated by runs of >2*context equal lines.
  const hunks = [];
  let current = null;
  let equalRun = 0;

  for (let index = 0; index < ops.length; index++) {
    const op = ops[index];
    if (op.type === 'equal') {
      if (current) {
        equalRun++;
        current.ops.push(op);
        if (equalRun > context * 2) {
          current.ops.length -= (equalRun - context);
          hunks.push(current);
          current = null;
          equalRun = 0;
        }
      }
      continue;
    }

    equalRun = 0;
    if (!current) {
      const start = Math.max(0, index - context);
      current = { ops: ops.slice(start, index) };
    }
    current.ops.push(op);
  }
  if (current) {
    if (equalRun > context) current.ops.length -= (equalRun - context);
    hunks.push(current);
  }

  const lines = [`--- ${fromFile}`, `+++ ${toFile}`];
  for (const hunk of hunks) {
    const first = hunk.ops[0];
    const oldStart = (first.oldIndex ?? findFirst(hunk.ops, 'oldIndex') ?? 0) + 1;
    const newStart = (first.newIndex ?? findFirst(hunk.ops, 'newIndex') ?? 0) + 1;
    const oldCount = hunk.ops.filter(o => o.type !== 'insert').length;
    const newCount = hunk.ops.filter(o => o.type !== 'delete').length;

    lines.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const op of hunk.ops) {
      const prefix = op.type === 'insert' ? '+' : op.type === 'delete' ? '-' : ' ';
      lines.push(prefix + op.line);
    }
  }

  return lines.join('\n');
}

function findFirst(ops, key) {
  for (const op of ops) if (op[key] !== null && op[key] !== undefined) return op[key];
  return null;
}
