// Unit checks for src/editor/dim-edit.ts, the editor side of picking on a dimension figure (node --experimental-strip-types).
import assert from 'node:assert/strict';
import { dimFence, dragKind, drawEdit, pickEdit } from '../calcpad-web/src/editor/dim-edit.ts';

const doc = ['<!--sheet-->', 'L: 6 m', '```dim', 'image a.png 800x400', '  hdim 1,2 3,2 | x', '```', 'M: 1'];
const f = dimFence(doc, 3);
assert.deepEqual(f, { open: 3, close: 6 });
assert.equal(dimFence(doc, 2), null, 'a quantity line opens no fence');
assert.deepEqual(dimFence(['```dimension', 'image a 1x1'], 1), { open: 1, close: 3 }, 'a fence never closed runs to the end');

assert.equal(dragKind(0, 0, 100, 5), 'hdim');
assert.equal(dragKind(0, 0, 4, -100), 'vdim');
assert.equal(dragKind(0, 0, 100, 60), 'dim');

// A drag adds a line before the closing line, straightened, with the indentation of the line above, the cursor after "| ".
assert.deepEqual(drawEdit(doc, f, 'hdim', 10.4, 20, 300, 27), { line: 6, text: '  hdim 10,20 300,20 | ', caret: 23 });
assert.equal(drawEdit(doc, f, 'vdim', 10, 20, 14, 300).text.trim(), 'vdim 10,20 10,300 |');
assert.equal(drawEdit(['```dim', '```'], { open: 1, close: 2 }, 'dim', 0, 0, 30, 40).text, 'dim 0,0 30,40 | ');

// A click puts the point at the cursor, with the spaces the text needs; outside the fence it does nothing.
assert.deepEqual(pickEdit(['```dim', 'dim', '```'], { open: 1, close: 3 }, 2, 4, 7, 8), { line: 2, column: 4, text: ' 7,8 ' });
assert.deepEqual(pickEdit(['```dim', 'dim 1,1 ', '```'], { open: 1, close: 3 }, 2, 9, 7.6, 8), { line: 2, column: 9, text: '8,8 ' });
assert.deepEqual(pickEdit(['```dim', 'dim  | {L}', '```'], { open: 1, close: 3 }, 2, 5, 7, 8), { line: 2, column: 5, text: '7,8' });
assert.equal(pickEdit(doc, f, 2, 1, 7, 8), null, 'before the fence');
assert.equal(pickEdit(doc, f, 3, 1, 7, 8), null, 'on the opening line');
assert.equal(pickEdit(doc, f, 6, 1, 7, 8), null, 'on the closing line');
console.log('dim-edit: all ok');
