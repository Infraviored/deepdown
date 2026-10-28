// Runs in the page's MAIN world: it needs WIZ_global_data (session token) and
// same-origin fetch with the page's cookies.
(function () {
  'use strict';

  // A second copy (e.g. the store build next to a dev build) would add the
  // menu entries twice.
  if (window.__deepdown) return;
  window.__deepdown = true;

  const { parseBatchResponse, findReports, reportToMarkdown } = globalThis.GeminiMd;
  const RPC = 'hNvQHb';
  const MARK = 'data-deepdown';
  const cache = new Map(); // chatId -> Promise<report[]>

  function chatId() {
    const m = location.pathname.match(/\/(?:app|gem\/[^/]+)\/([0-9a-f]{8,})/);
    return m && m[1];
  }

  async function fetchReports(id) {
    const wiz = window.WIZ_global_data || {};
    if (!wiz.SNlM0e) throw new Error('Gemini session token not found');
    const prefix = (location.pathname.match(/^\/u\/\d+/) || [''])[0];
    const params = new URLSearchParams({
      rpcids: RPC,
      'source-path': location.pathname,
      bl: wiz.cfb2h || '',
      'f.sid': wiz.FdrFJe || '',
      hl: document.documentElement.lang || 'en',
      _reqid: String(100000 + Math.floor(Math.random() * 900000)),
      rt: 'c',
    });
    // Same request the page sends when opening a chat; 10 is its page size.
    const req = JSON.stringify([[[RPC, JSON.stringify(['c_' + id, 10, null, 1, [1], [4], null, 1]), null, 'generic']]]);
    const res = await fetch(`${prefix}/_/BardChatUi/data/batchexecute?${params}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: new URLSearchParams({ 'f.req': req, at: wiz.SNlM0e }).toString(),
    });
    if (!res.ok) throw new Error(`batchexecute ${res.status}`);
    return parseBatchResponse(await res.text(), RPC).flatMap(findReports);
  }

  function reportsFor(id, refresh) {
    if (refresh || !cache.has(id)) {
      const p = fetchReports(id);
      // Only evict our own entry: a newer fetch may have replaced it.
      p.catch(() => cache.get(id) === p && cache.delete(id));
      cache.set(id, p);
    }
    return cache.get(id);
  }

  function panelTitle(panel) {
    const toolbar = panel.querySelector('.toolbar');
    const el = toolbar && toolbar.firstElementChild;
    return el && !el.classList.contains('action-buttons') ? el.textContent.trim() : '';
  }

  // The report id from the menu identifies the report exactly. Without one,
  // fall back to the panel title (the response lists turns newest first, so
  // the first match is the version shown), or to the only report there is.
  function pick(reports, { reportId, title }) {
    if (reportId) return reports.find((r) => r.id === reportId);
    return reports.find((r) => r.title === title) || (reports.length === 1 ? reports[0] : undefined);
  }

  // A miss in cached data usually means the cache predates the report (it was
  // still being written), so refetch once before giving up.
  async function currentReport(target, refresh) {
    const id = chatId();
    if (!id) throw new Error('No chat id in URL');
    let report = pick(await reportsFor(id, refresh), target);
    if (!report && !refresh) report = pick(await reportsFor(id, true), target);
    if (!report) throw new Error('report not found in this chat (it may be more than 10 turns back)');
    return report;
  }

  // Gemini's own menu items carry the report id ("im_…") inside the base64
  // BardVeMetadataKey of their jslog attribute.
  function reportIdFromMenu(menu) {
    for (const el of menu.querySelectorAll('[jslog*="BardVeMetadataKey:"]')) {
      const b64 = el.getAttribute('jslog').split('BardVeMetadataKey:')[1].split(';')[0];
      try {
        const m = atob(b64).match(/im_[0-9a-f]+/);
        if (m) return m[0];
      } catch {}
    }
    return null;
  }

  function fileName(report) {
    const clean = (report.title || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '').replace(/\s+/g, ' ').trim();
    // Cut by code points so an emoji is never split in half.
    const base = Array.from(clean).slice(0, 120).join('').trim().replace(/^\.+/, '');
    return (base || 'gemini-deep-research') + '.md';
  }

  // ClipboardItem accepts a promise, so the write is registered while the
  // click's user activation is fresh even if the report still has to load.
  function copyMarkdown(mdPromise) {
    if (typeof ClipboardItem === 'function' && navigator.clipboard.write) {
      const blob = mdPromise.then((md) => new Blob([md], { type: 'text/plain' }));
      return navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
    }
    return mdPromise.then((md) => navigator.clipboard.writeText(md));
  }

  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  let toastEl;
  function toast(text) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'deepdown-toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.classList.add('show');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.classList.remove('show'), 3000);
  }

  function closeMenu() {
    const backdrop = document.querySelector('.cdk-overlay-backdrop');
    if (backdrop) backdrop.click();
  }

  // Clone one of Gemini's menu items so ours inherit its styling, then swap
  // icon and label. The clone has no Angular listeners, only ours.
  function menuItem(template, icon, label, onClick) {
    const item = template.cloneNode(true);
    for (const a of ['jslog', 'data-test-id', 'aria-label', 'value', 'leadingicon']) item.removeAttribute(a);
    item.setAttribute(MARK, '');
    item.setAttribute('aria-label', label);
    const iconEl = item.querySelector('mat-icon');
    if (iconEl) {
      iconEl.setAttribute('fonticon', icon);
      iconEl.setAttribute('data-mat-icon-name', icon);
    }
    const labelEl = item.querySelector('.label');
    if (labelEl) labelEl.textContent = label;
    item.addEventListener('click', onClick);
    item.addEventListener('mouseenter', () => item.setAttribute('data-active', 'true'));
    item.addEventListener('mouseleave', () => item.setAttribute('data-active', 'false'));
    return item;
  }

  // Returns false while the menu has no items yet, so the caller retries.
  function extendMenu(menu, panel) {
    const template = menu.querySelector('copy-button gem-menu-item') || menu.querySelector('gem-menu-item');
    if (!template) return false;
    menu.setAttribute(MARK, '');
    const target = { reportId: reportIdFromMenu(menu), title: panelTitle(panel) };
    // Load now, while the user picks an entry: the report may have finished
    // since the chat was opened.
    const id = chatId();
    if (id) reportsFor(id, true).catch(() => {});
    const run = (action, done) => async (ev) => {
      ev.stopPropagation();
      closeMenu();
      try {
        // Shift-click refetches, e.g. after the report was edited.
        const report = currentReport(target, ev.shiftKey);
        await action(report.then(reportToMarkdown), report);
        toast(done);
      } catch (err) {
        console.error('[deepdown]', err);
        toast('Markdown export failed: ' + err.message);
      }
    };
    const copy = menuItem(template, 'code', 'Copy as Markdown', run((md) => copyMarkdown(md), 'Markdown copied'));
    const save = menuItem(
      template,
      'download',
      'Download Markdown',
      run(async (md, report) => download(fileName(await report), await md), 'Markdown downloaded'),
    );
    const after = template.closest('copy-button') || template;
    after.after(copy, save);
    return true;
  }

  // Remember which panel opened the next menu: regular chat answers have a
  // similar Share & Export menu that we leave alone.
  let openedFrom = null;
  document.addEventListener(
    'click',
    (ev) => {
      const btn = ev.target.closest && ev.target.closest('deep-research-immersive-panel .export-menu-button');
      openedFrom = btn ? { panel: btn.closest('deep-research-immersive-panel'), at: Date.now() } : openedFrom;
    },
    true,
  );

  const style = document.createElement('style');
  style.textContent = `.deepdown-toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,20px);opacity:0;
    pointer-events:none;z-index:10000;padding:14px 16px;border-radius:4px;background:#e3e3e3;color:#1f1f1f;
    font:500 14px/20px "Google Sans Flex","Google Sans",Roboto,sans-serif;box-shadow:0 3px 5px rgba(0,0,0,.2);
    transition:opacity .15s,transform .15s}
    .deepdown-toast.show{opacity:1;transform:translate(-50%,0)}`;

  function scan() {
    if (!openedFrom || Date.now() - openedFrom.at > 2000) return;
    const menu = document.querySelector('.cdk-overlay-container .mat-mdc-menu-panel:not([' + MARK + '])');
    if (menu && extendMenu(menu, openedFrom.panel)) openedFrom = null;
  }

  function start() {
    document.head.appendChild(style);
    scan();
    let queued = false;
    const schedule = () => {
      if (queued) return;
      queued = true;
      setTimeout(() => {
        queued = false;
        scan();
      }, 50);
    };
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  }

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
