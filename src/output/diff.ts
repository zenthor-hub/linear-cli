/**
 * Minimal line-based unified diff for dry-run previews.
 *
 * Common prefix/suffix lines are trimmed before an LCS pass over the changed
 * middle, so a one-section edit in a large document stays cheap. When the
 * changed middle is too large for LCS, it is rendered as one delete+insert block
 * (still a correct diff, just less minimal).
 */

type Op = { kind: " " | "-" | "+"; line: string };

const MAX_LCS_CELLS = 4_000_000;

function middleOps(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  if (n === 0) return b.map((line) => ({ kind: "+", line }));
  if (m === 0) return a.map((line) => ({ kind: "-", line }));
  if (n * m > MAX_LCS_CELLS) {
    return [
      ...a.map((line): Op => ({ kind: "-", line })),
      ...b.map((line): Op => ({ kind: "+", line })),
    ];
  }

  // lcs[i][j] = LCS length of a[i..] and b[j..], stored row-major.
  const width = m + 1;
  const lcs = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] =
        a[i] === b[j]
          ? (lcs[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(lcs[(i + 1) * width + j] ?? 0, lcs[i * width + j + 1] ?? 0);
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: " ", line: a[i] as string });
      i++;
      j++;
    } else if ((lcs[(i + 1) * width + j] ?? 0) >= (lcs[i * width + j + 1] ?? 0)) {
      ops.push({ kind: "-", line: a[i] as string });
      i++;
    } else {
      ops.push({ kind: "+", line: b[j] as string });
      j++;
    }
  }
  while (i < n) ops.push({ kind: "-", line: a[i++] as string });
  while (j < m) ops.push({ kind: "+", line: b[j++] as string });
  return ops;
}

function diffOps(a: string[], b: string[]): Op[] {
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++;
  }
  return [
    ...a.slice(0, prefix).map((line): Op => ({ kind: " ", line })),
    ...middleOps(a.slice(prefix, a.length - suffix), b.slice(prefix, b.length - suffix)),
    ...a.slice(a.length - suffix).map((line): Op => ({ kind: " ", line })),
  ];
}

/**
 * Render a unified diff of `before` -> `after`. Returns "" when identical.
 */
export function unifiedDiff(
  before: string,
  after: string,
  labels: { from: string; to: string } = { from: "a", to: "b" },
  context = 3,
): string {
  if (before === after) return "";
  const ops = diffOps(before.split("\n"), after.split("\n"));

  // Group change indices into hunks with `context` lines of surrounding context.
  const ranges: Array<[number, number]> = [];
  for (const [index, op] of ops.entries()) {
    if (op.kind === " ") continue;
    const start = Math.max(0, index - context);
    const end = Math.min(ops.length, index + context + 1);
    const last = ranges.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else ranges.push([start, end]);
  }

  // Line numbers (1-based) of each op in the old and new files.
  const oldAt: number[] = [];
  const newAt: number[] = [];
  let oldLine = 0;
  let newLine = 0;
  for (const op of ops) {
    oldAt.push(oldLine);
    newAt.push(newLine);
    if (op.kind !== "+") oldLine++;
    if (op.kind !== "-") newLine++;
  }

  const out = [`--- ${labels.from}`, `+++ ${labels.to}`];
  for (const [start, end] of ranges) {
    const slice = ops.slice(start, end);
    const oldCount = slice.filter((op) => op.kind !== "+").length;
    const newCount = slice.filter((op) => op.kind !== "-").length;
    const oldStart = (oldAt[start] ?? 0) + (oldCount > 0 ? 1 : 0);
    const newStart = (newAt[start] ?? 0) + (newCount > 0 ? 1 : 0);
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const op of slice) out.push(`${op.kind}${op.line}`);
  }
  return out.join("\n");
}
