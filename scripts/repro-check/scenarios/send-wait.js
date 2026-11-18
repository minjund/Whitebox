'use strict';
// Scenario: summary-mode message stuck as queued while the AI is idle.
// Checked: v2.0.22/26/28 Y, v2.0.29/34 N. Uses the real claude CLI with Haiku:
// 1 prompt when the bug shows (the message never leaves), 2 prompts when it works,
// plus the app's own summary analysis calls.
const P1 = 'reply with only the word grape in uppercase';
const P1_WORD = 'GRAPE';
const P2 = 'reply with only the word melon in uppercase';
const P2_WORD = 'MELON';

// A reply word counts only on a line that is not the echoed prompt (Haiku may answer in lowercase).
function replyVisible(text, word) {
  const re = new RegExp(`\\b${word}\\b`, 'i');
  return text.split('\n').some(line => re.test(line) && !/the word|in uppercase/i.test(line) && !/^\s*❯/.test(line));
}
const busy = text => /esc to interrupt/i.test(text);

module.exports = {
  name: 'send-wait',
  complaint: 'AI 답변을 이미 마쳤는데 왜 자꾸 전송대기라고 뜨는거야',
  symptom: 'AI가 답을 마치고 놀고 있는데, 요약 모드에서 보낸 내 메시지가 60초 넘게 "전송 대기"(Queued)로 남고 터미널에 들어가지 않는다.',
  needsClaude: true,
  timeoutSec: 330,

  async steps(page, ctx) {
    // 1. Claude (Haiku) in a new terminal, then switch to Summary mode.
    const id = await ctx.newClaude({ model: 'haiku' });
    await page.waitFor(() => { const b = document.querySelector('[data-workspace-mode=summary]'); return b && !b.disabled; }, '요약 버튼 켜짐', 90000);
    await ctx.sleep(1500);
    await page.click('[data-workspace-mode=summary]');
    await page.waitFor(() => document.querySelector('#terminalWorkspace')?.classList.contains('summary-mode'), '요약 모드', 20000);

    // 2. First request typed straight into the terminal, so the AI has a finished answer.
    await ctx.type(id, P1);
    await ctx.sleep(400);
    await ctx.enter(id);
    let streak = null, done = null;
    const until = Date.now() + 120000;
    while (!done && Date.now() < until) {
      const text = await ctx.terminalText(id);
      if (replyVisible(text, P1_WORD) && !busy(text)) { streak = streak || Date.now(); if (Date.now() - streak >= 3000) done = streak; } else streak = null;
      if (!done) await ctx.sleep(500);
    }
    if (!done) return { symptom: null, note: 'AI가 첫 답을 120초 안에 끝내지 않음' };
    ctx.log({ ev: 'p1-done' });
    await ctx.sleep(5000);

    // 3. Second request through the Summary input, like the user. Then just wait.
    await page.fill('#wbSummaryInput', P2);
    await page.click('#wbSummarySend');
    const sentAt = Date.now();
    ctx.log({ ev: 'p2-sent' });
    await page.shot('0-sent');
    while (Date.now() - sentAt < 75000) {
      const text = await ctx.terminalText(id);
      const st = await page.eval(prefix => {
        const users = [...document.querySelectorAll('#wbSummaryTranscript article.wb-summary-user')]
          .map(a => ({ state: a.dataset.state, text: (a.querySelector('p')?.textContent || '').slice(0, 60) }));
        const q = s => document.querySelector(s);
        return { mine: users.find(u => u.text.startsWith(prefix)) || null, users: users.map(u => u.state),
          title: q('#wbSummaryStateTitle')?.textContent || '', reply: q('#wbSummaryReplyState')?.textContent || '' };
      }, P2.slice(0, 30));
      const sec = Math.round((Date.now() - sentAt) / 1000);
      const written = text.includes(P2.slice(0, 30)) || Boolean(st.mine && !['queued', 'sending'].includes(st.mine.state));
      ctx.log({ ev: 'tick', sec, written, busy: busy(text), ...st, tail: text.split('\n').filter(l => l.trim()).slice(-4).join(' | ').slice(-300) });
      if (written) {
        // Delivered. Let the reply show for the screenshot (best effort), then N.
        const replyUntil = Date.now() + 60000;
        while (Date.now() < replyUntil && !replyVisible(await ctx.terminalText(id), P2_WORD)) await ctx.sleep(1000);
        await page.shot('1-delivered');
        return { symptom: false, note: `${sec}초 만에 터미널로 나감` };
      }
      if (sec >= 60 && st.mine?.state === 'queued' && !busy(text)) {
        await page.shot('1-still-queued');
        return { symptom: true, note: `AI는 놀고 있는데 ${sec}초째 "전송 대기" (상태 제목: ${st.title.slice(0, 40)})` };
      }
      await ctx.sleep(1000);
    }
    await page.shot('1-unclear');
    return { symptom: null, note: '75초 동안 나가지도, 대기로 확정되지도 않음' };
  },
};
