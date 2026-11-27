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
check(/^image data:image\/png;base64,\S+ 1600x800 width 640$/.test(lines[4] ?? ''), `the picture is scaled to 1600 x 800 and its size written (${(lines[4] ?? '').replace(/base64,\S+/, 'base64,…')})`);
check(lines.some(l => l.startsWith('// hdim 160,680 1440,680 offset -80 | {L}')), 'a starter horizontal dimension in the picture\'s pixels');
check(lines[lines.indexOf('```dim') + 7] === '```' && lines.at(-1) === 'h: 450 mm', 'the fence is closed and the rest of the sheet follows');
const pos = await page.evaluate(() => window.calcpadActiveEditor.getPosition().lineNumber);
check(lines[pos - 1]?.startsWith('// hdim'), `the cursor lands on the first starter line (line ${pos})`);
await page.evaluate(() => window.calcpadActiveEditor.trigger('t', 'undo', null));
check(!(await page.evaluate(() => window.calcpadActiveEditor.getValue())).includes('```dim'), 'one undo takes the picture away');

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
check(after[3] === '```dim' && / 300x200 width 300$/.test(after[4] ?? ''), `the ribbon button inserts the picture as a dim fence (${(after[4] ?? '').replace(/base64,\S+/, 'base64,…')})`);
await page.click('[data-ribbon-tab="math"]');
check(await page.locator('[data-ribbon-btn="r-dimfig"]').count() === 1, 'the Math tab has the button too');

await browser.close();
console.log(fails.length ? `${fails.length} FAIL` : 'all ok');
process.exit(fails.length ? 1 : 0);
