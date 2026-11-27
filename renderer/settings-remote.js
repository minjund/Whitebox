'use strict';
// Settings › Remote: the phone page switch, its address and QR code, the
// Tailscale state, connected phones, phones that get notifications, and the
// SSH way as an advanced fallback.
(() => {
  const STATE_TEXT = {
    off: '꺼져 있어요. 켜면 같은 Tailscale 계정의 휴대폰에서 이 컴퓨터의 Claude·Codex 대화를 보고 보낼 수 있어요.',
    starting: '켜는 중…',
    on: '켜져 있어요. 휴대폰에서 아래 주소를 여세요.',
    'no-tailscale': 'Tailscale이 설치되어 있지 않아요. 이 컴퓨터와 휴대폰에 Tailscale을 설치하고 같은 계정으로 로그인하세요.',
    'tailscale-off': 'Tailscale이 꺼져 있거나 로그인되어 있지 않아요. Tailscale을 켜고 로그인하세요.',
    'port-busy': '7790~7799 포트를 다른 프로그램이 모두 쓰고 있어 켜지 못했어요.',
    error: '휴대폰 페이지를 켜지 못했어요.'
  };
  // Why the page is still on http (it can then be opened but not installed as an app).
  const HTTPS_TEXT = {
    'no-magicdns': 'Tailscale의 MagicDNS가 꺼져 있어 앱으로 설치할 수 없어요. Tailscale 관리 화면의 DNS에서 MagicDNS와 HTTPS Certificates를 켜세요.',
    'https-off': '앱으로 설치하려면 Tailscale 관리 화면의 DNS에서 HTTPS Certificates를 켜세요. 켜면 이 컴퓨터의 Tailscale 이름이 인증서 공개 기록에 남아요.',
    'cert-pending': 'HTTPS 인증서를 받는 중이에요. 처음에는 1분쯤 걸려요.',
    'cert-failed': 'HTTPS 인증서를 받지 못했어요. 10분 뒤 다시 시도해요.'
  };
  const TAILSCALE_DNS = 'https://login.tailscale.com/admin/dns';
  let root = null, status = null, unsubscribe = null, timer = 0;
  const t = text => window.WhiteboxWorkspaceI18n?.t(text) || text;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);

  function copyButton(value) {
    return `<button type="button" class="wb-remote-copy" data-copy="${escape(value)}">${escape(t('복사'))}</button>`;
  }
  function render() {
    if (!root) return;
    if (!status?.available) { root.innerHTML = `<p class="wb-remote-note">${escape(t('이 Whitebox에서는 휴대폰 페이지를 쓸 수 없어요.'))}</p>`; return; }
    const on = status.state === 'on';
    const devices = status.devices || [], pushDevices = status.pushDevices || [];
    root.innerHTML = `
      <div class="wb-setting-row"><div><label for="wbRemoteEnabled"><strong>${escape(t('휴대폰에서 열기'))}</strong></label><p id="wbRemoteDescription">${escape(t(STATE_TEXT[status.state] || STATE_TEXT.error))}</p></div>
        <label class="wb-setting-switch"><input id="wbRemoteEnabled" type="checkbox" role="switch" aria-describedby="wbRemoteDescription" ${status.enabled ? 'checked' : ''}/><span></span></label></div>
      ${on ? `<div class="wb-remote-address">
        <div class="wb-remote-qr" aria-label="${escape(t('휴대폰 카메라로 찍으면 주소가 열려요'))}">${status.qr || ''}</div>
        <div><p class="wb-remote-label">${escape(t('휴대폰 주소'))}</p>
          <p class="wb-remote-url"><code>${escape(status.url)}</code>${copyButton(status.url)}</p>
          ${status.nameUrl ? `<p class="wb-remote-url"><code>${escape(status.nameUrl)}</code>${copyButton(status.nameUrl)}</p>` : ''}
          <p class="wb-remote-note">${escape(t(status.https ? '휴대폰 카메라로 QR을 찍거나 주소를 연 뒤 [앱으로 설치]를 누르면 앱처럼 쓸 수 있어요. 아이폰은 공유 › 홈 화면에 추가.' : '휴대폰 카메라로 QR을 찍거나 주소를 여세요.'))}</p></div>
      </div>` : ''}
      ${on && !status.https && HTTPS_TEXT[status.httpsReason] ? `<p class="wb-remote-note">${escape(t(HTTPS_TEXT[status.httpsReason]))}${['no-magicdns', 'https-off'].includes(status.httpsReason) ? ` <button type="button" class="wb-remote-copy" data-open="${TAILSCALE_DNS}">${escape(t('Tailscale DNS 설정 열기'))}</button>` : ''}</p>` : ''}
      ${status.enabled && (status.state === 'no-tailscale' || status.state === 'tailscale-off') ? `<p class="wb-remote-note"><button type="button" class="wb-remote-copy" data-open="https://tailscale.com/download">${escape(t('Tailscale 내려받기'))}</button></p>` : ''}
      ${on ? `<div class="wb-setting-row"><div><strong>${escape(t('연결된 휴대폰'))}</strong><p>${devices.length ? devices.map(device => `${escape(device.device)}${device.os ? ` · ${escape(device.os)}` : ''}${device.live ? ` · ${escape(t('보는 중'))}` : ''}`).join('<br>') : escape(t('아직 없어요'))}</p></div></div>` : ''}
      ${on ? `<div class="wb-setting-row"><div><strong>${escape(t('알림 받는 휴대폰'))}</strong><p>${pushDevices.length ? pushDevices.map(device => `${escape(device.device || t('휴대폰'))}${device.os ? ` · ${escape(device.os)}` : ''} <button type="button" class="wb-remote-copy" data-push-remove="${escape(device.id)}">${escape(t('알림 끄기'))}</button>`).join('<br>') : escape(t('휴대폰 페이지에서 [알림 받기]를 누르면 AI 작업이 끝나거나 답을 기다릴 때 알려 줘요.'))}</p></div></div>` : ''}
      <details class="wb-remote-ssh"><summary>${escape(t('SSH로 연결하기 (고급)'))}</summary>
        <p>${escape(t('휴대폰 SSH 앱(Termius 등)에서 이 컴퓨터에 로그인한 뒤 아래 명령을 입력하면 글자 터미널로 열려요. 컴퓨터에서 원격 로그인(SSH)을 켜야 해요.'))}</p>
        <p class="wb-remote-url">${escape(t('주소'))} <code>${escape(status.ip || '-')}</code>${status.ip ? copyButton(status.ip) : ''}</p>
        <p class="wb-remote-url">${escape(t('사용자 이름'))} <code>${escape(status.user || '-')}</code>${status.user ? copyButton(status.user) : ''}</p>
        <p class="wb-remote-url">${escape(t('명령'))} <code>whitebox phone</code>${copyButton('whitebox phone')}</p>
      </details>`;
  }
  async function refresh() {
    try { status = await window.whitebox.phoneStatus(); } catch { status = { available: false }; }
    render();
  }
  function bind(element) {
    element.addEventListener('change', async event => {
      if (event.target.id !== 'wbRemoteEnabled') return;
      event.target.disabled = true;
      try { status = await window.whitebox.setPhoneEnabled(event.target.checked); }
      catch { await refresh(); return; }
      render();
    });
    element.addEventListener('click', async event => {
      const link = event.target.closest('[data-open]');
      if (link) { window.whitebox.openExternal?.(link.dataset.open); return; }
      const remove = event.target.closest('[data-push-remove]');
      if (remove) {
        remove.disabled = true;
        try { status = await window.whitebox.removePhonePush(remove.dataset.pushRemove); render(); } catch { await refresh(); }
        return;
      }
      const button = event.target.closest('[data-copy]');
      if (!button) return;
      try { await (window.whitebox.writeClipboard ? window.whitebox.writeClipboard(button.dataset.copy) : navigator.clipboard.writeText(button.dataset.copy)); button.textContent = t('복사됨'); }
      catch { button.textContent = t('복사 못 함'); }
      setTimeout(() => { button.textContent = t('복사'); }, 1500);
    });
  }
  window.WhiteboxRemoteSettings = Object.freeze({
    open(element) {
      if (!element || !window.whitebox?.phoneStatus) return;
      if (root !== element) { root = element; bind(element); }
      if (!unsubscribe && window.whitebox.onPhoneStatus) unsubscribe = window.whitebox.onPhoneStatus(next => { status = next; render(); });
      clearInterval(timer);
      // The connected-phone list changes without a state change.
      timer = setInterval(refresh, 5000);
      return refresh();
    },
    close() { clearInterval(timer); timer = 0; }
  });
})();
