'use strict';
// Scenario: dropped terminal lands on the wrong side. No AI. Frozen from the complaint before reading the fix (v2.0.36).
// Drag mechanics read from the BEFORE code only (v2.0.35 renderer/terminal-workspace.js):
// a list row [data-drag-terminal] is dragged with pointer events onto a canvas pane
// (#wbCanvas .wb-pane[data-terminal-id]); the side comes from where it is let go in that pane
// (top 25% up, bottom 25% down, otherwise left/right half), and the pane shows data-drop-label.
//
// Verdict (frozen):
//   - A "counted" drop is one made while the canvas already shows 2 or more panes and the
//     target pane showed a drop label (왼쪽/오른쪽/위/아래에 배치) before letting go.
//   - Wrong place = 3 s after letting go, the dragged terminal is not shown on the canvas, or its
//     pane's centre is not on the labelled side of the target pane's centre (left: smaller x,
//     right: larger x, up: smaller y, down: larger y).
//   Y (symptom): 1 or more counted drops land in the wrong place.
//   N: 2 or more counted drops, all in the right place.
//   판정 불가: fewer than 2 counted drops (drag did not start, no label, panes not found).
//
// Limits: pointer events are synthetic (DOM dispatchEvent) and pointer capture is stubbed,
// because a synthetic pointer has no capture; the window is transparent.
module.exports = {
  name: 'drop-position',
  complaint: '드래그앤 드롭으로 창을 2개 이상 띄우면 내가 원하는 위치에 해당 창이 안뜨는 버그가 있어 수정해줘',
  symptom: '화면에 터미널이 2개 이상 떠 있을 때 터미널을 끌어 어떤 칸의 한쪽(왼쪽·오른쪽·위·아래)에 놓으면, 그 터미널이 놓은 쪽이 아닌 곳에 뜨거나 화면에 안 뜬다.',
  needsClaude: false,
  timeoutSec: 180,

  async steps(page, ctx) {
    const ids = [];
    for (let i = 0; i < 4; i++) { ids.push(await ctx.newShell()); await ctx.sleep(500); }
    await ctx.sleep(1500);
    await page.shot('0-start');

    const canvas = () => page.eval(() => [...document.querySelectorAll('#wbCanvas .wb-pane[data-terminal-id]')]
      .filter(n => { const r = n.getBoundingClientRect(); return r.width > 20 && r.height > 20; })
      .map(n => { const r = n.getBoundingClientRect(); return { id: n.dataset.terminalId, x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; }));

    // One drag: list row of `src` -> point inside pane `dst` on side `dir`. Returns the label shown.
    const drag = (src, dst, dir) => page.eval((src, dst, dir) => {
      Element.prototype.setPointerCapture = () => {};
      Element.prototype.releasePointerCapture = () => {};
      Element.prototype.hasPointerCapture = () => false;
      const row = document.querySelector('[data-drag-terminal="' + CSS.escape(src) + '"]');
      const pane = document.querySelector('#wbCanvas .wb-pane[data-terminal-id="' + CSS.escape(dst) + '"]');
      if (!row) return { ok: false, why: 'no-row' };
      if (!pane) return { ok: false, why: 'no-target-pane' };
      const rr = row.getBoundingClientRect(), pr = pane.getBoundingClientRect();
      const f = { left: [.15, .5], right: [.85, .5], up: [.5, .1], down: [.5, .9] }[dir];
      const tx = pr.left + pr.width * f[0], ty = pr.top + pr.height * f[1];
      const opt = (x, y) => ({ pointerId: 7, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, clientX: x, clientY: y, bubbles: true, cancelable: true, composed: true });
      const sx = rr.left + rr.width / 2, sy = rr.top + rr.height / 2;
      row.dispatchEvent(new PointerEvent('pointerdown', opt(sx, sy)));
      const at = (x, y) => document.elementFromPoint(x, y) || document.body;
      for (const k of [0.2, 0.5, 0.8, 1]) {
        const x = sx + (tx - sx) * k, y = sy + (ty - sy) * k;
        at(x, y).dispatchEvent(new PointerEvent('pointermove', opt(x, y)));
      }
      const labelled = document.querySelector('[data-drop-label]');
      const label = labelled ? labelled.dataset.dropLabel : null, shownDir = labelled ? labelled.dataset.dropDirection : null;
      const onTarget = labelled ? labelled === pane : false;
      at(tx, ty).dispatchEvent(new PointerEvent('pointerup', { ...opt(tx, ty), buttons: 0 }));
      return { ok: true, label, shownDir, onTarget };
    }, src, dst, dir);

    // Fixed plan of drops: [source index, side]; the target is the first other pane on the canvas.
    const plan = [[1, 'right'], [2, 'left'], [3, 'down'], [1, 'up'], [2, 'right'], [0, 'down']];
    let counted = 0, wrong = 0;
    const notes = [];
    for (let k = 0; k < plan.length; k++) {
      const [si, dir] = plan[k], src = ids[si];
      const before = await canvas();
      const target = before.find(p => p.id !== src);
      if (!target) { ctx.log({ ev: 'drop-skip', k, why: 'no-target', before }); continue; }
      const res = await drag(src, target.id, dir);
      await ctx.sleep(3000);
      const after = await canvas();
      const s = after.find(p => p.id === src), t = after.find(p => p.id === target.id);
      const right = Boolean(s && t && ({ left: s.x < t.x, right: s.x > t.x, up: s.y < t.y, down: s.y > t.y }[dir]));
      const count = before.length >= 2 && res.ok && res.shownDir === dir && res.onTarget;
      if (count) { counted++; if (!right) wrong++; }
      ctx.log({ ev: 'drop', k, src, target: target.id, dir, res, panesBefore: before.length, panesAfter: after.length, srcPane: s || null, targetPane: t || null, right, counted: count });
      await page.shot(`${k + 1}-drop-${dir}${count ? (right ? '-ok' : '-WRONG') : '-uncounted'}`);
      notes.push(`${dir}:${count ? (right ? 'ok' : 'WRONG') : '-'}`);
    }

    const note = `센 끌기 ${counted}번 중 엉뚱한 자리 ${wrong}번 (${notes.join(' ')})`;
    if (wrong >= 1) return { symptom: true, note };
    if (counted >= 2) return { symptom: false, note };
    return { symptom: null, note: `센 끌기가 2번 미만 · ${note}` };
  },
};
