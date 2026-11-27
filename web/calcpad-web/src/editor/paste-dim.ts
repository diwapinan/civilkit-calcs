// Paste a picture into a sheet: the picture goes in as a ```dim fence (calcpad-sheet/src/dim.rs), ready for
// dimension lines whose labels come from the sheet's quantities. The fence names the picture (`image [img1] WxH`,
// its size in pixels being the coordinate system of the figure) and the picture's data goes at the end of the sheet
// as `[img1]: data:image/...`, a line the editor hides (attachPictureHiding) so the long data stays out of the way.
// In a Calcpad worksheet (no dim fences there) the picture goes in as Calcpad's own image line.
// A picture larger than MAX_SIDE on its longer side is scaled down first, so the sheet stays a sensible size.
import * as monaco from 'monaco-editor';
import { SHEET_LANGUAGE } from './sheet-language';

/** The longer side of a pasted picture, in pixels, after scaling down. */
export const MAX_SIDE = 1600;

/** A pasted picture, ready to write into the document. */
export interface PastedPicture {
    src: string;
    width: number;
    height: number;
}

/** A picture definition line: `[name]: data:image/...` (the sheet compiler's image_def). */
export const PICTURE_DEF = /^\[([A-Za-z0-9_-]+)\]:\s*data:image\/\S+\s*$/;
/** An image line of a dim fence that names its picture: `image [name] ...`. */
const PICTURE_USE = /^\s*image\s+\[([A-Za-z0-9_-]+)\]/i;

/** A name for a new picture that no definition in the document has: img1, img2, ... */
export function newPictureName(lines: string[]): string {
    const taken = new Set(lines.map(l => PICTURE_DEF.exec(l)?.[1]).filter(Boolean));
    let n = 1;
    while (taken.has(`img${n}`)) n++;
    return `img${n}`;
}

/** The lines (1-based) of the picture definitions that some fence uses: the ones the editor hides. */
export function usedPictureLines(lines: string[]): number[] {
    const used = new Set(lines.map(l => PICTURE_USE.exec(l)?.[1]).filter(Boolean));
    const out: number[] = [];
    lines.forEach((l, i) => { const m = PICTURE_DEF.exec(l); if (m && used.has(m[1])) out.push(i + 1); });
    return out;
}

/** The size a picture is scaled to so that neither side passes `max`. */
export function fitSize(width: number, height: number, max = MAX_SIDE): { width: number; height: number } {
    const k = Math.min(1, max / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/**
 * The ```dim fence for a picture: the image line, then commented starter lines in the picture's own
 * coordinates (a style, a horizontal dimension under the picture and a vertical one at its right), to uncomment and edit.
 */
export function dimFence(p: PastedPicture, shown = Math.min(p.width, 640), name?: string): string {
    const { width: w, height: h } = p;
    const m = (v: number) => Math.round(v);
    const x0 = m(w * 0.1), x1 = m(w * 0.9), y0 = m(h * 0.15), y1 = m(h * 0.85);
    const off = Math.max(10, m(Math.max(w, h) / 20));
    return [
        '```dim',
        `image ${name ? `[${name}]` : p.src} ${w}x${h} width ${m(shown)}`,
        `// Points are pixels of the picture (x right, y down from the top left). Remove // to draw a line.`,
        `// style arrow tick color #37474f text above decimals 2`,
        `// hdim ${x0},${y1} ${x1},${y1} offset -${off} | {L}`,
        `// vdim ${x1},${y0} ${x1},${y1} offset -${off} | h = {h -> mm}`,
        `// text ${m(w / 2)},${m(h / 2)} | w = {w -> kN/m}`,
        '```',
    ].join('\n');
}

/** Calcpad's own image line, for a worksheet. */
export function imageLine(p: PastedPicture): string {
    return `'<img src="${p.src}" width="${Math.min(p.width, 640)}">`;
}

/** The first picture on a clipboard, or null when it holds text (text pastes as usual). */
export function clipboardPicture(data: DataTransfer | null): File | null {
    if (!data) return null;
    if ((data.getData('text/plain') ?? '').trim() !== '') return null;
    for (const item of Array.from(data.items ?? [])) {
        if (item.kind === 'file' && item.type.startsWith('image/')) return item.getAsFile();
    }
    return null;
}

/** Reads a picture, scaled down to MAX_SIDE, as a data: URL with its size. SVG and GIF keep their bytes. */
export async function readPicture(blob: Blob): Promise<PastedPicture> {
    const url = URL.createObjectURL(blob);
    try {
        const img = new Image();
        img.src = url;
        await img.decode();
        const nw = img.naturalWidth || 800, nh = img.naturalHeight || 600;
        const fit = fitSize(nw, nh);
        const keep = blob.type === 'image/svg+xml' || blob.type === 'image/gif' || (fit.width === nw && fit.height === nh);
        if (keep) return { src: await dataUrl(blob), width: fit.width, height: fit.height };
        const canvas = document.createElement('canvas');
        canvas.width = fit.width;
        canvas.height = fit.height;
        const g = canvas.getContext('2d');
        if (!g) return { src: await dataUrl(blob), width: nw, height: nh };
        g.imageSmoothingQuality = 'high';
        g.drawImage(img, 0, 0, fit.width, fit.height);
        const type = blob.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
        return { src: canvas.toDataURL(type, 0.9), width: fit.width, height: fit.height };
    } finally {
        URL.revokeObjectURL(url);
    }
}

function dataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
    });
}

/**
 * Writes a picture into the editor at the cursor: a dim fence in a sheet, an image line in a worksheet.
 * It goes on lines of its own after the cursor's line, as one undo step, and the cursor lands on the
 * first starter line so the user can begin with it.
 */
export function insertPicture(editor: monaco.editor.ICodeEditor, p: PastedPicture): void {
    const model = editor.getModel();
    const sel = editor.getSelection();
    if (!model || !sel) return;
    const sheet = model.getLanguageId() === SHEET_LANGUAGE;
    const name = sheet ? newPictureName(model.getLinesContent()) : undefined;
    const block = sheet ? dimFence(p, undefined, name) : imageLine(p);
    const line = sel.endLineNumber;
    const end = model.getLineMaxColumn(line);
    const here = model.getLineContent(line).trim() !== '';
    const text = (here ? '\n\n' : '') + block + '\n';
    const edits: monaco.editor.IIdentifiedSingleEditOperation[] = [{ range: new monaco.Range(line, end, line, end), text, forceMoveMarkers: true }];
    if (name) {
        // The picture's data at the end of the sheet (hidden by attachPictureHiding), after a blank line.
        const last = model.getLineCount();
        const lastEnd = model.getLineMaxColumn(last);
        const gap = model.getLineContent(last).trim() === '' ? '' : '\n';
        edits.push({ range: new monaco.Range(last, lastEnd, last, lastEnd), text: `${gap}\n[${name}]: ${p.src}` });
    }
    editor.pushUndoStop();
    editor.executeEdits('paste-picture', edits);
    editor.pushUndoStop();
    const first = line + (here ? 2 : 0) + (sheet ? 4 : 0);
    editor.setPosition({ lineNumber: first, column: 1 });
    editor.revealLineInCenterIfOutsideViewport(first);
    editor.focus();
}

/** Asks for a picture file and writes it into the editor as a paste would (the ribbon's Dimension figure). */
export function pickPicture(editor: monaco.editor.ICodeEditor | null | undefined): Promise<boolean> {
    if (!editor?.getModel()) return Promise.resolve(false);
    return new Promise(resolve => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml';
        input.style.display = 'none';
        input.addEventListener('change', () => {
            const file = input.files?.[0];
            input.remove();
            if (!file) { resolve(false); return; }
            readPicture(file).then(p => { insertPicture(editor, p); resolve(true); }, err => {
                console.warn('[dimension figure] not inserted:', err);
                resolve(false);
            });
        });
        input.addEventListener('cancel', () => { input.remove(); resolve(false); });
        document.body.appendChild(input);
        input.click();
    });
}

/**
 * Lets a picture on the clipboard paste into the editor (Ctrl+V or the browser's Paste). Text, and a
 * clipboard holding both text and a picture (a spreadsheet range, say), paste as before.
 */
export function attachPicturePaste(editor: monaco.editor.ICodeEditor): monaco.IDisposable {
    // On the window, in the capture phase: the page has paste handlers on the way down to the editor
    // that stop the event, and this one has to see it first. Only a paste into this editor is taken.
    const node = editor.getContainerDomNode();
    const onPaste = (e: ClipboardEvent) => {
        if (!(e.target instanceof Node) || !node.contains(e.target)) return;
        if (!editor.hasTextFocus() || editor.getOption(monaco.editor.EditorOption.readOnly)) return;
        const file = clipboardPicture(e.clipboardData);
        if (!file) return;
        e.preventDefault();
        e.stopPropagation();
        void readPicture(file).then(p => insertPicture(editor, p), err => console.warn('[paste picture] not inserted:', err));
    };
    window.addEventListener('paste', onPaste, true);
    return { dispose: () => window.removeEventListener('paste', onPaste, true) };
}

/**
 * Hides the picture definitions that a fence uses (`[img1]: data:image/...` at the end of a sheet), so the long data
 * does not fill the editor. One that no fence uses any more shows again, so it can be deleted.
 */
export function attachPictureHiding(editor: monaco.editor.ICodeEditor): monaco.IDisposable {
    const ed = editor as monaco.editor.ICodeEditor & { setHiddenAreas?: (r: monaco.IRange[], source?: unknown) => void };
    if (typeof ed.setHiddenAreas !== 'function') return { dispose() { /* this Monaco cannot hide lines */ } };
    const SOURCE = 'ck-pictures';
    let timer: ReturnType<typeof setTimeout> | null = null;
    let shown = '';
    const update = () => {
        timer = null;
        const model = editor.getModel();
        const lines = model && model.getLanguageId() === SHEET_LANGUAGE ? usedPictureLines(model.getLinesContent()) : [];
        const key = lines.join(',');
        if (key === shown) return;
        shown = key;
        ed.setHiddenAreas!(lines.map(n => new monaco.Range(n, 1, n, 1)), SOURCE);
    };
    const later = () => { if (timer) clearTimeout(timer); timer = setTimeout(update, 150); };
    const subs = [
        editor.onDidChangeModelContent(later),
        editor.onDidChangeModel(() => { shown = '\u0000'; later(); }),
        editor.onDidChangeModelLanguage(() => { shown = '\u0000'; later(); }),
    ];
    later();
    return { dispose: () => { if (timer) clearTimeout(timer); subs.forEach(d => d.dispose()); } };
}
