// Unit checks for src/editor/dim-edit.ts, the editor side of picking on a dimension figure (node --experimental-strip-types).
import assert from 'node:assert/strict';
import { dimFence, dimInsertLine, dragKind, drawEdit, fenceNear, pickEdit } from '../calcpad-web/src/editor/dim-edit.ts';

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
// The Dimension style menu: the fence near the cursor, and where a style or a line goes in it.
const two = ['<!--sheet-->', '```dim', 'image [a] 10x10', 'style color red', '// note', 'hdim 1,1 9,1', '```', 'x: 1', '```dim', 'image [b] 10x10', '```'];
assert.deepEqual(fenceNear(two, 6), { open: 2, close: 7 }, 'the fence that holds the cursor');
assert.deepEqual(fenceNear(two, 8), { open: 2, close: 7 }, 'else the nearest one above');
assert.deepEqual(fenceNear(two, 1), { open: 2, close: 7 }, 'else the first one below');
assert.equal(fenceNear(['<!--sheet-->', 'x: 1'], 2), null, 'no fence');
assert.equal(dimInsertLine(two, { open: 2, close: 7 }, 6, 'style arrow tick'), 5, 'a style goes after the image and style lines');
assert.equal(dimInsertLine(two, { open: 2, close: 7 }, 6, 'vdim 1,1 1,9'), 7, 'a line goes after the cursor line');
assert.equal(dimInsertLine(two, { open: 2, close: 7 }, 8, 'vdim 1,1 1,9'), 7, 'from outside, before the closing line');
assert.equal(dimInsertLine(two, { open: 9, close: 11 }, 10, 'style arrow dot'), 11, 'a style in a fence of a picture only');
console.log('dim-edit: all ok');
