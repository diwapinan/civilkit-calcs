// The preview's picking on a dimension figure (src/wasm/dim-pick.ts), in a page of its own: hovering shows the point in
// the picture's pixels, a drag posts dimDraw (with a dashed line while it lasts), a click posts dimPick, and neither
// reaches the page's own click handler.   node e2e/dim-pick-check.mjs   (CHROME=/path/to/chrome to use another browser)
import { chromium } from 'playwright';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DIM_PICK_SCRIPT } from '../calcpad-web/src/wasm/dim-pick.ts';

const fails = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };
// The figure as the sheet compiler writes it (800 x 400 picture shown 640 px wide), on line 7 of the sheet.
const fig = '<div class="ck-dimfig" data-source-line="7" style="position:relative;display:inline-block;width:640px;aspect-ratio:800 / 400;line-height:0">'
    + '<img src="data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACwAAAAAAQABAAACAkQBADs=" style="display:block;width:100%;height:100%">'
    + '<svg viewBox="0 0 800 400" preserveAspectRatio="none" style="position:absolute;left:0;top:0;width:100%;height:100%"></svg></div>';
const frame = `<!doctype html><body style="margin:20px">${fig}<script>window.clicks=0;document.addEventListener('click',function(){window.clicks++});`
    + `document.addEventListener('DOMContentLoaded', function() { var FRAME_ID = 'g1';\n${DIM_PICK_SCRIPT}\n});</script></body>`;
const dir = mkdtempSync(join(tmpdir(), 'dim-pick-'));
writeFileSync(join(dir, 'frame.html'), frame);
writeFileSync(join(dir, 'index.html'), '<!doctype html><body style="margin:0"><iframe id="f" src="frame.html" style="width:760px;height:500px;border:0"></iframe>'
    + '<script>window.got=[];addEventListener("message",e=>got.push(e.data));</script></body>');

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const page = await browser.newPage({ viewport: { width: 800, height: 520 } });
await page.goto('file://' + join(dir, 'index.html'));
const f = page.frameLocator('#f');
await f.locator('.ck-dim-tip').waitFor({ state: 'attached', timeout: 5000 });
const box = await f.locator('.ck-dimfig').boundingBox();
const P = (x, y) => [box.x + x * box.width / 800, box.y + y * box.height / 400];
await page.mouse.move(...P(100, 300));
check((await f.locator('.ck-dim-tip').textContent()).startsWith('100,300'), 'hovering shows the point in the picture\'s pixels');
await page.mouse.down();
await page.mouse.move(...P(400, 306), { steps: 5 });
check(await f.locator('.ck-dim-ghost').count() === 1, 'a dashed line follows the drag');
check((await f.locator('.ck-dim-tip').textContent()) === 'hdim 100,300 400,300', 'the drag is read as a horizontal dimension');
await page.mouse.up();
await page.mouse.click(...P(250, 120));
await page.waitForTimeout(200);
const got = await page.evaluate(() => window.got);
check(got[0]?.type === 'dimDraw' && got[0].fence === 7 && got[0].kind === 'hdim' && got[0].x1 === 100 && got[0].x2 === 400, `a drag posts dimDraw (${JSON.stringify(got[0])})`);
check(got[1]?.type === 'dimPick' && got[1].fence === 7 && got[1].x === 250 && got[1].y === 120 && got[1].line === 7, `a click posts dimPick (${JSON.stringify(got[1])})`);
check(await f.locator('.ck-dim-ghost').count() === 0, 'the dashed line goes when the drag ends');
check(await page.frame({ url: /frame\.html$/ }).evaluate(() => window.clicks) === 0, 'the page\'s own click handler does not see them');
await browser.close();
console.log(fails.length ? `${fails.length} FAIL` : 'all ok');
process.exit(fails.length ? 1 : 0);
