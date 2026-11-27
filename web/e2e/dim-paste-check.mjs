// Pasting a picture into a sheet writes a ```dim fence with the picture's size, ready for dimension lines
// (editor/paste-dim.ts); a clipboard with text still pastes the text.   node e2e/dim-paste-check.mjs [--url U]
import { chromium } from 'playwright';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const url = arg('--url', 'http://127.0.0.1:4180/');
const fails = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const page = await (await browser.newContext({ viewport: { width: 1300, height: 900 } })).newPage();
await page.goto(url);
await page.waitForFunction(() => window.calcpadActiveEditor != null, null, { timeout: 60000 });
await page.evaluate(t => window.calcpadActiveEditor.setValue(t), ['<!--sheet-->', 'L: 6 m', 'h: 450 mm'].join('\n'));
await page.waitForFunction(() => window.calcpadActiveEditor.getModel().getLanguageId() === 'calcpad-sheet', null, { timeout: 20000 });

// A 2000 x 1000 picture on the clipboard, pasted with the cursor on line 2.
const paste = (withText) => page.evaluate(async (withText) => {
    const ed = window.calcpadActiveEditor;
    ed.setPosition({ lineNumber: 2, column: 3 });
    ed.focus();
    const c = document.createElement('canvas');
    c.width = 2000; c.height = 1000;
    const g = c.getContext('2d'); g.fillStyle = '#c9d3dc'; g.fillRect(100, 600, 1800, 200);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'shot.png', { type: 'image/png' }));
    if (withText) dt.setData('text/plain', 'x: 1 m');
    const target = document.activeElement;
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, withText);

await paste(false);
await page.waitForFunction(() => window.calcpadActiveEditor.getValue().includes('```dim'), null, { timeout: 10000 }).catch(() => {});
const lines = (await page.evaluate(() => window.calcpadActiveEditor.getValue())).split('\n');
check(lines[1] === 'L: 6 m' && lines[2] === '', `the fence goes after the cursor's line, with a blank line (${JSON.stringify(lines.slice(1, 4).map(l => l.slice(0, 20)))})`);
check(lines[3] === '```dim', 'the fence opens with ```dim');
check(lines[4] === 'image [img1] 1600x800 width 640', `the fence names the picture, scaled to 1600 x 800, with its size (${lines[4]})`);
check(/^\[img1\]: data:image\/png;base64,\S+$/.test(lines.at(-1) ?? '') && lines.at(-2) === '', 'the picture\'s data goes at the end of the sheet, after a blank line');
await page.waitForTimeout(400);
const shownText = await page.evaluate(() => (document.querySelector('.monaco-editor .view-lines')?.textContent ?? '').replace(/\u00a0/g, ' '));
check(!shownText.includes('base64') && shownText.includes('image [img1]'), 'the editor hides the data line');
check(lines.some(l => l.startsWith('// hdim 160,680 1440,680 offset -80 | {L}')), 'a starter horizontal dimension in the picture\'s pixels');
check(lines[lines.indexOf('```dim') + 7] === '```' && lines[lines.indexOf('```dim') + 9] === 'h: 450 mm', 'the fence is closed and the rest of the sheet follows');
const pos = await page.evaluate(() => window.calcpadActiveEditor.getPosition().lineNumber);
check(lines[pos - 1]?.startsWith('// hdim'), `the cursor lands on the first starter line (line ${pos})`);
await page.evaluate(() => window.calcpadActiveEditor.trigger('t', 'undo', null));
const undone = await page.evaluate(() => window.calcpadActiveEditor.getValue());
check(!undone.includes('```dim') && !undone.includes('[img1]'), 'one undo takes the fence and the data away');

await paste(true);
await page.waitForTimeout(800);
check(!(await page.evaluate(() => window.calcpadActiveEditor.getValue())).includes('```dim'), 'a clipboard with text does not paste as a picture');

// The ribbon's Dimension figure button (Plots & Diagrams tab): a picture from a file goes in the same way.
await page.evaluate(t => { const ed = window.calcpadActiveEditor; ed.setValue(t); ed.setPosition({ lineNumber: 2, column: 1 }); }, ['<!--sheet-->', 'L: 6 m'].join('\n'));
await page.click('[data-ribbon-tab="plots"]');
const png = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 300; c.height = 200;
    const b = await new Promise(r => c.toBlob(r, 'image/png'));
    return Array.from(new Uint8Array(await b.arrayBuffer()));
});
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-ribbon-btn="pl-dimfig"]')]);
await chooser.setFiles({ name: 'beam.png', mimeType: 'image/png', buffer: Buffer.from(png) });
await page.waitForFunction(() => window.calcpadActiveEditor.getValue().includes('```dim'), null, { timeout: 10000 }).catch(() => {});
const after = (await page.evaluate(() => window.calcpadActiveEditor.getValue())).split('\n');
check(after[3] === '```dim' && after[4] === 'image [img1] 300x200 width 300', `the ribbon button inserts the picture as a dim fence (${after[4]})`);
// A second picture takes the next name; deleting a fence shows its data line again, to be deleted.
await page.evaluate(() => window.calcpadActiveEditor.setPosition({ lineNumber: 2, column: 1 }));
const [chooser2] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-ribbon-btn="pl-dimfig"]')]);
await chooser2.setFiles({ name: 'b.png', mimeType: 'image/png', buffer: Buffer.from(png) });
await page.waitForFunction(() => window.calcpadActiveEditor.getValue().includes('[img2]:'), null, { timeout: 10000 }).catch(() => {});
check((await page.evaluate(() => window.calcpadActiveEditor.getValue())).includes('image [img2] 300x200'), 'a second picture is img2');
await page.evaluate(() => { const ed = window.calcpadActiveEditor; ed.setValue(ed.getValue().replace(/```dim\nimage \[img2\][\s\S]*?```\n/, '')); });
await page.waitForTimeout(500);
const shown2 = await page.evaluate(() => (document.querySelector('.monaco-editor .view-lines')?.textContent ?? '').replace(/\u00a0/g, ' '));
check(shown2.includes('[img2]: data:') && !shown2.includes('[img1]: data:'), 'an unused picture\'s data shows; a used one stays hidden');
// The Dimension style menu puts a style after the picture line of the fence, and a line after the cursor's line.
await page.evaluate(() => { const ed = window.calcpadActiveEditor; const ls = ed.getModel().getLinesContent(); ed.setPosition({ lineNumber: ls.indexOf('```dim') + 1 + 4, column: 1 }); });
await page.click('[data-ribbon-btn="pl-dimstyle"]');
await page.click('[data-ribbon-glyph="Architectural"]');
await page.click('[data-ribbon-btn="pl-dimstyle"]');
await page.click('[data-ribbon-glyph="Horizontal"]');
await page.waitForTimeout(300);
const st = (await page.evaluate(() => window.calcpadActiveEditor.getValue())).split('\n');
const o = st.indexOf('```dim');
check(st[o + 2] === 'style arrow tick color #37474f weight 2 text above box off', `a style goes after the picture line (${st[o + 2]})`);
check(st.some((l, i) => i > o && l === 'hdim 100,400 700,400 offset -40 | {L}' && st.indexOf('```', o + 1) > i), 'a line goes into the fence');
await page.click('[data-ribbon-tab="math"]');
check(await page.locator('[data-ribbon-btn="r-dimfig"]').count() === 1, 'the Math tab has the button too');

await browser.close();
console.log(fails.length ? `${fails.length} FAIL` : 'all ok');
process.exit(fails.length ? 1 : 0);
