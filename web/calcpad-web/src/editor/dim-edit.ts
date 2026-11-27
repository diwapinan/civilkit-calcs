// The editor side of picking on a dimension figure in the preview (wasm/dim-pick.ts): where a ```dim fence
// is, the text a drag adds (a new dimension line), and the text a click puts at the cursor (a point).
// Pure functions on the document's lines, 1-based line and column numbers as Monaco counts them.

/** A ```dim fence: its opening line and its closing line (one past the end when it is never closed). */
export interface DimFence {
    open: number;
    close: number;
}

const OPEN = /^\s*```\s*(dim|dimension)\s*$/i;

/** The fence that opens on `open`, or null when that line does not open a ```dim fence. */
export function dimFence(lines: string[], open: number): DimFence | null {
    if (!OPEN.test(lines[open - 1] ?? '')) return null;
    for (let n = open + 1; n <= lines.length; n++) {
        if (/^\s*```/.test(lines[n - 1])) return { open, close: n };
    }
    return { open, close: lines.length + 1 };
}

/** A point as the fence writes it: whole pixels, `x,y`. */
export function pointText(x: number, y: number): string {
    return `${Math.round(x)},${Math.round(y)}`;
}

/** Which dimension a drag from (x1,y1) to (x2,y2) is: horizontal or vertical within `snap` degrees, else aligned. */
export function dragKind(x1: number, y1: number, x2: number, y2: number, snap = 8): 'hdim' | 'vdim' | 'dim' {
    const a = Math.abs(Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI);
    if (a <= snap || a >= 180 - snap) return 'hdim';
    if (Math.abs(a - 90) <= snap) return 'vdim';
    return 'dim';
}

/** The line a drag adds, and where the cursor goes in it (after `| `, for the label). */
export function drawLine(kind: string, x1: number, y1: number, x2: number, y2: number): { text: string; caret: number } {
    // A snapped dimension is straight: the second point takes the first one's y (horizontal) or x (vertical).
    if (kind === 'hdim') y2 = y1;
    if (kind === 'vdim') x2 = x1;
    const text = `${kind} ${pointText(x1, y1)} ${pointText(x2, y2)} | `;
    return { text, caret: text.length + 1 };
}

/**
 * The edit a drag makes: a new line before the fence's closing line, with the indentation of the line above it.
 * `line` is where the new line goes and `caret` the cursor's column in it.
 */
export function drawEdit(lines: string[], f: DimFence, kind: string, x1: number, y1: number, x2: number, y2: number):
    { line: number; text: string; caret: number } {
    const above = lines[f.close - 2] ?? '';
    const indent = f.close - 1 > f.open ? (/^[ \t]*/.exec(above)?.[0] ?? '') : '';
    const d = drawLine(kind, x1, y1, x2, y2);
    return { line: f.close, text: indent + d.text, caret: indent.length + d.caret };
}

/**
 * The edit a click makes: the point at the cursor, with a space on either side where the text needs one.
 * Null when the cursor is not on a line inside the fence (the click then does what it did before).
 */
export function pickEdit(lines: string[], f: DimFence, line: number, column: number, x: number, y: number):
    { line: number; column: number; text: string } | null {
    if (line <= f.open || line >= f.close) return null;
    const s = lines[line - 1] ?? '';
    const before = s.slice(0, column - 1), after = s.slice(column - 1);
    let text = pointText(x, y);
    if (before !== '' && !/\s$/.test(before)) text = ' ' + text;
    if (after !== '' && !/^\s/.test(after)) text += ' ';
    else if (after === '') text += ' ';
    return { line, column, text };
}
