// calcpad-rs: picking points on a dimension figure (a ```dim fence, calcpad-sheet/src/dim.rs) in the preview.
//
// With a mouse over a figure the preview shows the pointer's position in the picture's pixels (the figure's
// coordinates). A drag draws a new dimension: the frame posts `dimDraw` and the host adds the line to the fence
// (horizontal or vertical when the drag is within a few degrees of it). A click posts `dimPick`: the host puts
// the point at the editor's cursor when that is inside the fence, and otherwise does what a click on the
// figure did before (it selects the fence). The host side is editor/dim-edit.ts.

/** ES5 for the preview frame, run where FRAME_ID is in scope. No "</script", no template placeholders. */
export const DIM_PICK_SCRIPT = String.raw`
(function() {
  var figs = document.querySelectorAll('.ck-dimfig');
  if (!figs.length || !window.matchMedia || !matchMedia('(hover:hover) and (pointer:fine)').matches) return;
  var css = '.ck-dimfig{cursor:crosshair}'
    + '.ck-dim-tip{position:absolute;z-index:3;pointer-events:none;font:11px/1.3 system-ui,sans-serif;color:#fff;background:rgba(20,20,20,.78);'
    + 'padding:2px 6px;border-radius:3px;white-space:nowrap;transform:translate(10px,10px);display:none}'
    + '.ck-dimfig:hover .ck-dim-tip{display:block}'
    + '@media print{.ck-dim-tip,.ck-dim-ghost{display:none}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  var NS = 'http://www.w3.org/2000/svg';
  var suppress = false;
  function say(m) { m.groupId = FRAME_ID; try { window.parent.postMessage(m, '*'); } catch (_e) {} }
  Array.prototype.forEach.call(figs, function(fig) {
    var svg = fig.querySelector('svg');
    var vb = svg && svg.viewBox && svg.viewBox.baseVal;
    if (!vb || !vb.width || !vb.height) return;
    var fence = parseInt(fig.getAttribute('data-source-line') || '', 10);
    if (isNaN(fence)) return;
    var tip = document.createElement('div'); tip.className = 'ck-dim-tip'; fig.appendChild(tip);
    function at(e) {
      var r = fig.getBoundingClientRect();
      return { x: Math.round((e.clientX - r.left) / r.width * vb.width), y: Math.round((e.clientY - r.top) / r.height * vb.height), r: r };
    }
    function kind(a, b) {
      var d = Math.abs(Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI);
      return d <= 8 || d >= 172 ? 'hdim' : Math.abs(d - 90) <= 8 ? 'vdim' : 'dim';
    }
    var start = null, ghost = null;
    fig.addEventListener('dragstart', function(e) { e.preventDefault(); });
    fig.addEventListener('pointermove', function(e) {
      var p = at(e);
      tip.style.left = (e.clientX - p.r.left) + 'px'; tip.style.top = (e.clientY - p.r.top) + 'px';
      if (!start) { tip.textContent = p.x + ',' + p.y + '  (drag: add a dimension, click: put x,y at the cursor)'; return; }
      var k = kind(start, p), x2 = k === 'vdim' ? start.x : p.x, y2 = k === 'hdim' ? start.y : p.y;
      tip.textContent = k + ' ' + start.x + ',' + start.y + ' ' + x2 + ',' + y2;
      if (!ghost) {
        ghost = document.createElementNS(NS, 'line'); ghost.setAttribute('class', 'ck-dim-ghost');
        ghost.setAttribute('stroke', '#1565c0'); ghost.setAttribute('stroke-dasharray', '6 4');
        ghost.setAttribute('stroke-width', String(Math.max(1, Math.max(vb.width, vb.height) / 400)));
        svg.appendChild(ghost);
      }
      ghost.setAttribute('x1', start.x); ghost.setAttribute('y1', start.y); ghost.setAttribute('x2', x2); ghost.setAttribute('y2', y2);
    });
    fig.addEventListener('pointerdown', function(e) {
      if (e.button !== 0 || e.pointerType !== 'mouse') return;
      e.preventDefault();
      start = at(e); start.cx = e.clientX; start.cy = e.clientY;
      try { fig.setPointerCapture(e.pointerId); } catch (_e) {}
    });
    function end(e, cancel) {
      if (!start) return;
      var s = start; start = null;
      if (ghost) { ghost.parentNode.removeChild(ghost); ghost = null; }
      if (cancel) return;
      var p = at(e);
      suppress = true; setTimeout(function() { suppress = false; }, 0);
      if (Math.abs(e.clientX - s.cx) + Math.abs(e.clientY - s.cy) > 6) {
        say({ type: 'dimDraw', fence: fence, kind: kind(s, p), x1: s.x, y1: s.y, x2: p.x, y2: p.y });
      } else {
        say({ type: 'dimPick', fence: fence, x: p.x, y: p.y, line: fence,
              rect: { left: p.r.left, top: p.r.top, width: p.r.width, height: p.r.height } });
      }
    }
    fig.addEventListener('pointerup', function(e) { end(e, false); });
    fig.addEventListener('pointercancel', function(e) { end(e, true); });
  });
  // The click that ends a pick or a drag is not also a click on the line (which would open its editor).
  window.addEventListener('click', function(e) {
    var t = e.target;
    if (suppress || (t && t.closest && t.closest('.ck-dimfig'))) { e.stopPropagation(); e.preventDefault(); }
  }, true);
})();
`;
