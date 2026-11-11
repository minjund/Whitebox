'use strict';
const assert = require('node:assert/strict');

// Summary composer screenshots: pick, paste and drop; previews with removal;
// queued requests keep their images and send their IDs when flushed.
exports.run = async evaluate => {
  const result = await evaluate(`(async () => {
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    const settle = async () => { for (let i = 0; i < 20; i++) await tick(); };
    const check = (condition, message) => { if (!condition) throw Error(message); };
    const png = async () => {
      const canvas = document.createElement('canvas'); canvas.width = 4; canvas.height = 3;
      canvas.getContext('2d').fillRect(0, 0, 4, 3);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      return new File([blob], 'shot.png', { type: 'image/png' });
    };
    function make() {
      const root = document.createElement('div');
      root.append(document.querySelector('.wb-mode-switch').cloneNode(true), document.querySelector('#wbSummary').cloneNode(true), document.querySelector('#wbCanvas').cloneNode(false));
      document.body.append(root);
      const member = { creationId: 'epoch', pid: 100, providerPid: 101, provider: 'claude', ready: true, observedAt: Date.now(), activity: { state: 'idle' } };
      const stats = { saves: [], removes: [], payloads: [] };
      let next = 0;
      const chat = WhiteboxSummaryChat({ root, t: text => text, esc: WhiteboxRendererUtils.esc,
        activeId: () => 'shots', session: () => ({ status: 'running', creationId: 'epoch', pid: 100 }),
        member: () => member, tasks: () => [], review: () => ({ state: 'ready' }), snapshot: () => ({ text: '' }),
        label: () => 'shots', groupId: () => 'group', gameVisibility: () => 'always', gameBehavior: () => 'auto-collapse',
        save: () => {}, reveal: () => {}, report: () => {}, submitted: () => {}, refresh: async () => { chat.observe([]); },
        captureReply: async () => true,
        api: {
          providerUsage: async () => ({ providers: {} }), slashCommands: async () => [],
          summaryAttachmentSave: async payload => {
            check(payload.data instanceof Uint8Array && payload.data[0] === 0x89, 'image bytes cross as a Uint8Array');
            stats.saves.push(payload.type);
            if (stats.failNext) { stats.failNext = false; throw Error("Error invoking remote method 'summary-attachments:save': Error: PNG, JPG, GIF, WebP 이미지만 첨부할 수 있어요."); }
            const id = String(++next).padStart(8, '0') + '-0000-4000-8000-000000000000.png';
            return { id, path: '/data/summary-attachments/' + id, type: 'image/png', size: payload.data.length };
          },
          summaryAttachmentRemove: async ids => { stats.removes.push(...ids); return { removed: ids.length }; },
          terminalCollaboration: async payload => {
            stats.payloads.push(payload);
            if (!member.ready) return { deferred: true, reason: 'working' };
            const request = payload.attachments ? payload.message + '\\n\\n' + payload.attachments.map(id => '첨부 이미지: /data/summary-attachments/' + id).join('\\n') : payload.message;
            return { ok: true, job: { id: payload.id, state: 'running', sentAt: Date.now(), request } };
          },
        } });
      chat.restore([{ id: 'shots', creationId: 'epoch', mode: 'summary', messages: [] }]);
      chat.render();
      const $ = selector => root.querySelector(selector);
      const thumbs = () => [...root.querySelectorAll('#wbSummaryAttachments li[data-state=ready]')];
      const submit = async text => { $('#wbSummaryInput').value = text; $('#wbSummaryForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await settle(); };
      return { root, chat, member, stats, $, thumbs, submit, dispose: () => root.remove() };
    }
    const cases = [];
    let f = make();
    check(f.$('#wbSummaryAttachments').hidden && f.$('#wbSummaryAttach'), 'composer has an attach button and no previews yet');
    // Paste from the clipboard.
    let data = new DataTransfer(); data.items.add(await png());
    let paste = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    f.$('#wbSummaryInput').dispatchEvent(paste); await settle();
    check(paste.defaultPrevented && f.thumbs().length === 1 && f.stats.saves[0] === 'image/png', 'pasted image is saved and previewed: ' + f.thumbs().length);
    check(/^data:image\\/jpeg;base64,/u.test(f.thumbs()[0].querySelector('img').src), 'preview is a small inline JPEG');
    cases.push('paste');
    // Pick with the file dialog.
    data = new DataTransfer(); data.items.add(await png()); data.items.add(await png());
    f.$('#wbSummaryAttachInput').files = data.files;
    f.$('#wbSummaryAttachInput').dispatchEvent(new Event('change')); await settle();
    check(f.thumbs().length === 3 && f.$('#wbSummaryAttachInput').value === '', 'picked images are added: ' + f.thumbs().length);
    cases.push('pick');
    // Drag and drop, then the five-image limit.
    data = new DataTransfer(); for (let i = 0; i < 3; i++) data.items.add(await png());
    const drop = new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true });
    f.$('#wbSummaryInput').dispatchEvent(drop); await settle();
    check(drop.defaultPrevented && f.thumbs().length === 5, 'dropped images fill up to five: ' + f.thumbs().length);
    check(f.$('#wbSummaryNotice').textContent === '이미지는 한 번에 5장까지 보낼 수 있어요.' && f.$('#wbSummaryAttach').disabled, 'the sixth image is refused with a reason');
    cases.push('drop-limit');
    // Remove one with its × control.
    const removedId = f.thumbs()[1].querySelector('[data-summary-attachment-remove]').dataset.summaryAttachmentRemove;
    f.thumbs()[1].querySelector('button').click(); await settle();
    check(f.thumbs().length === 4 && f.stats.removes.includes(removedId), 'removed image leaves the composer and its file is deleted');
    cases.push('remove');
    // Non-images and main-process refusals keep the composer as it was.
    data = new DataTransfer(); data.items.add(new File(['hi'], 'note.txt', { type: 'text/plain' }));
    f.$('#wbSummaryInput').dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true })); await settle();
    check(f.thumbs().length === 4 && f.$('#wbSummaryNotice').textContent === 'PNG, JPG, GIF, WebP 이미지만 첨부할 수 있어요.', 'non-image drop is refused');
    f.thumbs()[3].querySelector('button').click(); await settle();
    f.stats.failNext = true;
    data = new DataTransfer(); data.items.add(await png());
    f.$('#wbSummaryInput').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); await settle();
    check(f.thumbs().length === 3 && f.$('#wbSummaryNotice').textContent === 'PNG, JPG, GIF, WebP 이미지만 첨부할 수 있어요.', 'main refusal shows its plain reason: ' + f.$('#wbSummaryNotice').textContent);
    cases.push('refusals');
    // Sending while the AI works queues the request with its images.
    const ids = f.thumbs().map(item => item.querySelector('button').dataset.summaryAttachmentRemove);
    f.member.ready = false;
    await f.submit('이 화면 봐줘');
    let saved = f.chat.serialize()[0];
    let queued = saved.messages.at(-1);
    check(queued.state === 'queued' && queued.attachments.map(item => item.id).join() === ids.join() && !saved.attachments.length, 'queued request keeps its images');
    check(f.thumbs().length === 0 && f.$('#wbSummaryAttachments').hidden, 'composer is cleared after sending');
    check(f.root.querySelector('.wb-summary-user .wb-summary-image-count').textContent === '이미지 3장' && f.root.querySelectorAll('.wb-summary-user-images img').length === 3, 'request bubble shows its images');
    // A restart restores the queued images with the request.
    f.chat.restore([saved]); f.chat.render();
    // Restored queued requests become "check delivery"; the user resends them.
    queued = f.chat.serialize()[0].messages.at(-1);
    check(queued.state === 'interrupted' && queued.attachments.length === 3, 'restored request still carries its images');
    f.root.querySelector('[data-summary-resend]').click(); await settle();
    check(f.chat.serialize()[0].messages.at(-1).state === 'queued', 'resent request waits again');
    f.member.ready = true; f.member.observedAt = Date.now();
    f.chat.observe([]); await settle();
    const sent = f.stats.payloads.filter(payload => payload.operation === 'summary-send').at(-1);
    check(sent.message === '이 화면 봐줘' && sent.attachments.join() === ids.join(), 'flushed send carries the image IDs: ' + JSON.stringify(sent));
    const message = f.chat.serialize()[0].messages.at(-1);
    check(message.state === 'sent' && message.delivered.includes('첨부 이미지: /data/summary-attachments/' + ids[0]), 'sent request records the text the AI received');
    check(f.root.querySelector('#wbSummaryPast .wb-summary-past-images')?.textContent === '이미지 3장', 'past request list marks the images');
    cases.push('queue-flush');
    // Cancelling a queued request deletes its images; editing returns them to the composer.
    data = new DataTransfer(); data.items.add(await png()); data.items.add(await png());
    f.$('#wbSummaryInput').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); await settle();
    f.member.ready = false;
    await f.submit('');
    queued = f.chat.serialize()[0].messages.at(-1);
    check(queued.text === '첨부한 이미지를 확인해 주세요.' && queued.attachments.length === 2, 'images alone make a request');
    const cancelIds = queued.attachments.map(item => item.id);
    f.root.querySelector('[data-summary-cancel="' + queued.id + '"]').click(); await settle();
    check(cancelIds.every(id => f.stats.removes.includes(id)) && !f.chat.serialize()[0].messages.at(-1).attachments, 'cancel deletes the queued images');
    data = new DataTransfer(); data.items.add(await png());
    f.$('#wbSummaryInput').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); await settle();
    await f.submit('고쳐서 보낼게');
    queued = f.chat.serialize()[0].messages.at(-1);
    const removesBefore = f.stats.removes.length;
    f.root.querySelector('[data-summary-edit="' + queued.id + '"]').click(); await settle();
    check(f.thumbs().length === 1 && f.$('#wbSummaryInput').value === '고쳐서 보낼게' && f.stats.removes.length === removesBefore, 'edit moves the images back without deleting them');
    cases.push('cancel-edit');
    f.dispose();
    return cases;
  })()`);
  assert.deepEqual(result, ['paste', 'pick', 'drop-limit', 'remove', 'refusals', 'queue-flush', 'cancel-edit']);
  console.log('PASS summary screenshot attachments: paste/pick/drop, 5-image limit, remove, refusals, queued images kept across restart and flushed as IDs, cancel deletes, edit restores');
};
