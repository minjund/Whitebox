'use strict';
// Scenario: trashed terminal missing from the trash. No AI.
// Checked: v2.0.23 Y 3/3, v2.0.25 N 3/3.
module.exports = {
  name: 'trash',
  complaint: '휴지통에 넣었는데 휴지통에 들어가는거같지않는 버그가 있는거같아 수정해줘',
  symptom: '왼쪽 목록에서 터미널을 휴지통 버튼으로 지웠는데, 휴지통을 열면 그 터미널이 없다.',
  needsClaude: false,
  timeoutSec: 120,

  async steps(page, ctx) {
    // 1. Two plain shell terminals; the first one gets some output.
    const first = await ctx.newShell();
    await ctx.type(first, `echo repro-${ctx.run}\r`);
    await ctx.newShell();
    await ctx.sleep(1500);
    await page.shot('0-before');

    // 2. Click the trash-icon button in the first terminal's row of the left list.
    const click = await page.eval(id => {
      const inst = document.querySelector('[data-instance="' + CSS.escape(id) + '"]');
      const row = inst ? inst.closest('.wb-instance-row') || inst.parentElement : null;
      if (!row) return { clicked: false, why: 'no-row' };
      const b = [...row.querySelectorAll('button')].find(x => x.innerHTML.includes('M3 6h18M9 6V3h6v3'));
      if (!b) return { clicked: false, why: 'no-trash-icon' };
      const info = { clicked: true, title: b.getAttribute('title') };
      b.click();
      return info;
    }, first);
    ctx.log({ ev: 'click-trash', click });
    if (!click.clicked) return { symptom: null, note: `휴지통 버튼을 못 찾음 (${click.why})` };

    // If a confirm dialog opens, confirm the move-to-trash action.
    await ctx.sleep(700);
    const dialog = await page.eval(() => {
      const d = document.querySelector('dialog[open]');
      if (!d) return null;
      const b = [...d.querySelectorAll('button')].find(x => /휴지통|trash|move|옮기|archive/i.test(x.textContent + ' ' + (x.value || '')) && !/취소|cancel|닫기|close/i.test(x.textContent));
      if (!b) return { id: d.id, clicked: false };
      b.click();
      return { id: d.id, clicked: b.textContent.trim().slice(0, 40) };
    });
    if (dialog) ctx.log({ ev: 'dialog', dialog });

    // 3. Wait up to 15 s for it to leave the list.
    let leftList = false;
    for (let i = 0; i < 15; i++) {
      const inList = await page.eval(id => Boolean(document.querySelector('[data-instance="' + CSS.escape(id) + '"]')), first);
      ctx.log({ ev: 'tick', i, inList });
      if (!inList) { leftList = true; if (i >= 3) break; }
      await ctx.sleep(1000);
    }
    await page.shot('1-after-click');

    // 4. Open the trash and read it.
    await page.click('[data-action="trash"]');
    await ctx.sleep(1500);
    const trash = await page.eval(() => ({
      count: document.querySelector('#wbTrashCount')?.textContent || '',
      list: (document.querySelector('#wbTrashList')?.textContent || '').replace(/\s+/g, ' ').slice(0, 400),
    }));
    await page.shot('2-trash-open');
    const listed = trash.list.includes(first.slice(-5));
    ctx.log({ ev: 'trash-open', trash, listed, leftList });

    // 5. Verdict (frozen before the run).
    const btn = click.title ? ` · 버튼 이름 "${click.title}"` : '';
    if (listed) return { symptom: false, note: `휴지통에 있음 (${trash.count}개)${btn}` };
    if (leftList && (trash.count === '0' || trash.count === '')) return { symptom: true, note: `목록에서 사라졌는데 휴지통은 비어 있음${btn}` };
    if (!leftList) return { symptom: null, note: '15초 뒤에도 목록에 그대로 있음' };
    return { symptom: null, note: `휴지통 개수 ${trash.count}인데 그 터미널은 안 보임` };
  },
};
