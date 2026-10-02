(function(){
  'use strict';
  // ── New-version check, shared by index.html and cma-tool.html ────────────
  // A FRESH open of either page is always current (the server tells browsers
  // to revalidate). What goes stale is a page that is ALREADY open (home-screen
  // app, long-lived tab). This file notices a newer deploy of the page it is
  // loaded on and either reloads on its own when that cannot lose work, or
  // shows a banner and lets the agent choose the moment. Plain DOM on purpose:
  // nothing here is in the Vue template or in setup()'s return.
  //
  // A page may set window.FOS_UPDATE BEFORE loading this file:
  //   page         path whose version tag is watched   (default '/index.html')
  //   title        banner heading
  //   message      banner body
  //   beforeReload function returning a promise; runs when the agent taps
  //                Update now and there is work. If it rejects, the page is
  //                NOT reloaded and the banner says why.
  //
  // Reload on its own ONLY when all of these hold:
  //   - the agent is coming back to the app (it was in the background),
  //   - nothing was typed, changed, pasted, dropped, dictated or generated
  //     since this copy was loaded,
  //   - they have not tapped or pressed a key since coming back,
  //   - no automatic reload happened in the last 10 minutes.
  // Every other case shows the banner.
  var CHECK_MS   = 5 * 60 * 1000;   // how often an open app looks
  var MIN_GAP_MS = 10 * 1000;       // never look more often than this
  var CONFIRM_MS = 2 * 1000;        // a new tag must be seen twice
  var SNOOZE_MS  = 30 * 60 * 1000;  // "Later" hides the banner this long
  var GUARD_MS   = 10 * 60 * 1000;  // at most one automatic reload per window
  var RETURN_MS  = 15 * 1000;       // "just came back" lasts this long
  var CFG   = window.FOS_UPDATE || {};
  var PAGE  = CFG.page || '/index.html';
  var TITLE = CFG.title || 'A new version of FORWARD OS is ready';
  var MSG   = CFG.message || 'Save your work or finish what you are doing first, then tap Update now. Anything you have not saved will be lost when the app updates.';
  var GUARD_KEY  = 'fos_update_reload_at:' + PAGE;

  var base = null;        // version tag this copy of the app was loaded with
  var pending = null;     // a different tag seen once, not yet confirmed
  var newer = false;      // a different tag seen twice in a row
  var dirty = false;      // work may exist in memory
  var returnedAt = 0;     // when the agent last came back from the background
  var touched = false;    // tapped / pressed a key since coming back
  var snoozeUntil = 0;
  var busy = false;
  var lastCheck = 0;
  var el = null;
  var saveFailed = false; // beforeReload rejected once; the next tap reloads anyway

  function norm(t) {
    if (!t) return '';
    var m = String(t).match(/[0-9a-f]{16,}/i);
    if (m) return m[0].toLowerCase();
    return String(t).replace(/^W\//, '').replace(/"/g, '').replace(/-df$/, '');
  }

  function getTag() {
    return fetch(PAGE + '?_=' + Date.now(), { method: 'HEAD', cache: 'no-store' })
      .then(function (r) { return r && r.ok ? norm(r.headers.get('etag')) : ''; });
  }

  function guardOk() {
    try {
      var at = parseInt(sessionStorage.getItem(GUARD_KEY) || '0', 10);
      return !at || (Date.now() - at) > GUARD_MS;
    } catch (e) { return false; }
  }

  function reload() {
    try { sessionStorage.setItem(GUARD_KEY, String(Date.now())); } catch (e) {}
    window.location.reload();
  }

  // The agent tapped Update now. Save first when the page knows how.
  function manualUpdate() {
    if (!dirty || saveFailed || typeof CFG.beforeReload !== 'function') { reload(); return; }
    var go = el.querySelector('._go');
    var m = el.querySelector('._m');
    go.disabled = true;
    go.textContent = 'Saving...';
    var p;
    try { p = Promise.resolve(CFG.beforeReload()); } catch (e) { p = Promise.reject(e); }
    p.then(reload, function (e) {
      saveFailed = true;
      go.disabled = false;
      go.textContent = 'Update anyway';
      m.textContent = 'Your work could NOT be saved: ' + ((e && e.message) || e || 'unknown error') +
        '. Nothing was updated. Fix that or download what you need first. Update anyway discards anything not saved.';
    });
  }

  function build() {
    if (el) return;
    var st = document.createElement('style');
    st.textContent =
      '#_fos_upd{position:fixed;top:0;left:0;right:0;z-index:2147483000;display:none;justify-content:center;padding:10px 12px;pointer-events:none;font-family:Montserrat,system-ui,sans-serif}' +
      '#_fos_upd._on{display:flex}' +
      '#_fos_upd ._c{pointer-events:auto;max-width:560px;width:100%;background:#0A2342;color:#F7F4EF;border:1px solid #C8A96E;border-radius:10px;padding:14px 16px;box-shadow:0 8px 28px rgba(10,35,66,.35)}' +
      '#_fos_upd ._t{font-size:14px;font-weight:600;color:#C8A96E;margin-bottom:5px}' +
      '#_fos_upd ._m{font-size:13px;line-height:1.5;margin-bottom:12px}' +
      '#_fos_upd ._b{display:flex;gap:10px;align-items:center}' +
      '#_fos_upd button{font-family:inherit;font-size:13px;font-weight:600;border-radius:7px;padding:9px 16px;cursor:pointer}' +
      '#_fos_upd ._go{background:#C8A96E;color:#0A2342;border:1px solid #C8A96E}' +
      '#_fos_upd ._no{background:transparent;color:#F7F4EF;border:1px solid rgba(247,244,239,.45)}';
    document.head.appendChild(st);
    el = document.createElement('div');
    el.id = '_fos_upd';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML =
      '<div class="_c">' +
        '<div class="_t"></div>' +
        '<div class="_m"></div>' +
        '<div class="_b"><button type="button" class="_go">Update now</button><button type="button" class="_no">Later</button></div>' +
      '</div>';
    el.querySelector('._t').textContent = TITLE;
    el.querySelector('._m').textContent = MSG;
    document.body.appendChild(el);
    el.querySelector('._go').addEventListener('click', manualUpdate);
    el.querySelector('._no').addEventListener('click', function () {
      snoozeUntil = Date.now() + SNOOZE_MS;
      hide();
    });
  }

  function show() { build(); el.classList.add('_on'); }
  function hide() { if (el) el.classList.remove('_on'); }

  function act() {
    if (!newer) return;
    var auto = returnedAt && (Date.now() - returnedAt) < RETURN_MS &&
               !dirty && !touched &&
               document.visibilityState === 'visible' && guardOk();
    if (auto) { reload(); return; }
    if (Date.now() >= snoozeUntil) show();
  }

  function check(force) {
    if (busy) return;
    if (document.visibilityState !== 'visible') return;
    if (!force && Date.now() - lastCheck < MIN_GAP_MS) { act(); return; }
    busy = true;
    lastCheck = Date.now();
    getTag().then(function (t) {
      busy = false;
      if (!t) return;
      if (base === null) { base = t; return; }
      if (t === base) { pending = null; if (newer) { newer = false; hide(); } return; }
      if (!newer && pending !== t) {
        pending = t;
        setTimeout(function () { check(true); }, CONFIRM_MS);
        return;
      }
      newer = true;
      act();
    }).catch(function () { busy = false; });
  }

  // Work that may exist only in memory.
  function setDirty() { dirty = true; }
  ['input', 'change', 'paste', 'drop'].forEach(function (ev) {
    document.addEventListener(ev, setDirty, true);
  });
  // Dictation fills fields without input events.
  try {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR && SR.prototype && typeof SR.prototype.start === 'function') {
      var srStart = SR.prototype.start;
      SR.prototype.start = function () { dirty = true; return srStart.apply(this, arguments); };
    }
  } catch (e) {}
  // Anything Claude generated may be on screen and unsaved.
  try {
    var prevFetch = window.fetch;
    window.fetch = function (u) {
      try {
        var url = typeof u === 'string' ? u : (u && u.url) || '';
        if (url.indexOf('api.anthropic.com') !== -1) dirty = true;
      } catch (e) {}
      return prevFetch.apply(this, arguments);
    };
  } catch (e) {}

  function setTouched() { touched = true; }
  document.addEventListener('pointerdown', setTouched, true);
  document.addEventListener('keydown', setTouched, true);

  function cameBack() {
    if (document.visibilityState !== 'visible') return;
    returnedAt = Date.now();
    touched = false;
    check(false);
  }
  document.addEventListener('visibilitychange', cameBack);
  window.addEventListener('pageshow', function (e) { if (e && e.persisted) cameBack(); });

  setInterval(function () { check(false); }, CHECK_MS);
  check(true);

  // Lets Marc see the banner without waiting for a deploy: add #update-preview to the address.
  if (window.location.hash === '#update-preview') {
    if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
  }

  window.fosUpdate = {
    check: function () { check(true); },
    state: function () {
      return { base: base, pending: pending, newer: newer, dirty: dirty, returnedAt: returnedAt,
               touched: touched, snoozed: Date.now() < snoozeUntil, shown: !!(el && el.classList.contains('_on')) };
    }
  };
})();
