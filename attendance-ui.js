/* Nazeer's Motor Spares — attendance & pay screens.
   Mount into any element:  NMSAttendance.mount(document.getElementById('x'), { storage, onChange })
   Needs attendance-core.js loaded first. Everything it draws lives inside the element (class .nms-att). */
(function (root) {
  'use strict';
  const C = root.NMSAttendanceCore;
  if (!C) throw new Error('Load attendance-core.js before attendance-ui.js');
  const { STATUS, STATUS_ORDER, num, round2, fmtDate, addDays } = C;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* default storage: this browser's localStorage */
  function localStore(key) {
    return {
      load() { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } },
      save(data) { localStorage.setItem(key, JSON.stringify(data)); },
    };
  }

  function mount(el, opts) {
    opts = opts || {};
    const storage = opts.storage || localStore(opts.storageKey || 'nms-attendance-v1');
    let data = C.normalise(storage.load());
    if (opts.business && !storage.load()) data.settings.business = opts.business;
    const ui = { tab: opts.startTab || 'today', day: C.localToday(), month: C.localToday().slice(0, 7), payOffset: 0 };

    el.classList.add('nms-att');
    const cloud = opts.cloud || null;
    function cloudLine() {
      if (!cloud) return 'Staff attendance &amp; pay';
      const s = cloud.status();
      return `<span class="na-dot ${s.signedIn && s.ok ? 'ok' : s.signedIn ? 'bad' : ''}"></span>${esc(s.signedIn ? s.text : 'This phone only')}`;
    }
    function passwordCard() {
      const s = cloud.status();
      if (!s.signedIn) return `<section class="na-card na-pad" id="na-cloud"><h3 class="na-h3">Share between phones</h3>
        <p class="na-hint">Sign in with the username and password you were given. Every phone signed in with it sees the same register and pay, and changes arrive on the other phones within about a minute. Without signal the app keeps working and catches up later.</p>
        <div class="na-form g2"><label class="na-fld"><span>Username</span><input id="na-email" type="text" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="e.g. nazeer"></label>
        <label class="na-fld"><span>Password</span><input id="na-pass" type="password" autocomplete="current-password"></label></div>
        <div class="na-actions" style="margin-top:12px"><button type="button" class="na-btn primary" data-a="cloud-in">Sign in</button></div></section>`;
      return `<section class="na-card na-pad" id="na-cloud"><h3 class="na-h3">Share between phones</h3>
        <p class="na-sync"><span class="na-dot ${s.ok ? 'ok' : 'bad'}"></span>${esc(s.text)}</p>
        <p class="na-hint">Signed in as <b>${esc(s.login || s.email)}</b>${s.role ? ` (${esc(s.role)})` : ''}. Every change is shared with the other phones.</p>
        <div class="na-actions"><button type="button" class="na-btn" data-a="cloud-sync">Sync now</button><button type="button" class="na-btn" data-a="cloud-pass">Change password</button><button type="button" class="na-btn ghost" data-a="cloud-out">Sign out</button></div></section>`;
    }

    function cloudCard() { return pinMode() ? phoneCard() : passwordCard(); }

    /* ---------- PIN lock (requireSignIn): each phone is set up once with its setup link, then opened with a 4-digit PIN ---------- */
    const pinMode = () => !!(cloud && opts.requireSignIn);
    const PIN_KEY = (opts.storageKey || 'nms-attendance-v1') + '-pin';
    const pinStore = () => { try { return JSON.parse(localStorage.getItem(PIN_KEY) || 'null'); } catch (e) { return null; } };
    const pinSet = () => !!(pinStore() || {}).hash;
    const clearPin = () => localStorage.removeItem(PIN_KEY);
    let locked = pinSet(), pinEntry = '', pinFirst = '', pinMsg = '', joining = '', joinError = '', hiddenAt = 0, pinBusy = false;
    async function pinHash(pin, salt) {
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 150000 }, key, 256);
      return btoa(String.fromCharCode(...new Uint8Array(bits)));
    }
    async function savePin(pin) {
      const salt = C.uid() + C.uid();
      localStorage.setItem(PIN_KEY, JSON.stringify({ salt, hash: await pinHash(pin, salt), fails: 0, until: 0 }));
    }
    /* true, false, or 'wait' after too many wrong tries (30 s, then doubling) */
    async function checkPin(pin) {
      const p = pinStore();
      if (!p) return true;
      if (Date.now() < (p.until || 0)) return 'wait';
      if (await pinHash(pin, p.salt) === p.hash) { p.fails = 0; p.until = 0; localStorage.setItem(PIN_KEY, JSON.stringify(p)); return true; }
      p.fails = (p.fails || 0) + 1;
      if (p.fails >= 5) p.until = Date.now() + 30000 * 2 ** Math.min(p.fails - 5, 6);
      localStorage.setItem(PIN_KEY, JSON.stringify(p));
      return false;
    }
    const gated = () => pinMode() && (!!joining || !cloud.status().signedIn || !pinSet() || locked);
    let wasGated = gated();
    function gateScreen() {
      const s = cloud.status();
      let body;
      if (joining) body = '<p class="na-gate-step">Setting up this phone…</p>';
      else if (!s.signedIn) body = (cloud.isRemoved()
          ? '<p class="na-gate-step"><b>This phone was signed out</b> because a new setup link was made. Ask Nazeer for the new link and tap it on this phone.</p>'
          : '<p>Staff attendance &amp; pay</p><p class="na-gate-step">To set up this phone, tap the <b>setup link</b> you were sent (on WhatsApp).</p>')
        + (joinError ? `<p class="na-pin-msg">${esc(joinError)}</p>` : '');
      else {
        const title = !pinSet() ? (pinFirst ? 'Type the same PIN again' : 'Choose a 4-digit PIN for this phone') : 'Enter your PIN';
        body = `${!pinSet() && !pinFirst ? '<p>This phone is connected. Choose a PIN — you will type it each time you open the app.</p>' : ''}
          <p class="na-pin-title">${title}</p>
          <div class="na-pin-dots" aria-hidden="true">${[0, 1, 2, 3].map((i) => `<span class="${i < pinEntry.length ? 'on' : ''}"></span>`).join('')}</div>
          <p class="na-pin-msg" role="status">${esc(pinMsg)}</p>
          <div class="na-pin-pad">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k) => (k ? `<button type="button" data-a="pin-key" data-k="${k}" aria-label="${k === '⌫' ? 'Delete' : k}">${k}</button>` : '<span></span>')).join('')}</div>
          ${pinSet() ? '<button type="button" class="na-gate-link" data-a="pin-forgot">Forgot PIN?</button>' : ''}`;
      }
      el.innerHTML = `<div class="na-gate"><div class="na-gate-box">
        <div class="na-gate-mark">NMS</div>
        <h1>${esc(data.settings.business || "Nazeer's Motor Spares")}</h1>
        ${body}</div></div>`;
    }
    /* a setup link was opened: https://…/#join=<login>.<secret> */
    async function handleJoin() {
      const j = cloud && cloud.parseLink && cloud.parseLink(location.hash);
      if (!j) return;
      history.replaceState(null, '', location.href.split('#')[0]);
      joining = j.login; joinError = ''; closeModal(); render();
      try {
        await cloud.signInWithLink(j.login, j.secret);
        clearPin(); locked = false; pinEntry = ''; pinFirst = ''; pinMsg = '';
      } catch (e) {
        joinError = e instanceof TypeError ? 'No internet connection — connect and tap the link again.'
          : /wrong username|invalid/i.test(e.message) ? 'This setup link no longer works. Ask Nazeer for a new one.' : e.message;
      }
      joining = ''; data = C.normalise(storage.load()); ui.tab = 'today'; render();
    }
    function onVisible() {
      if (!pinMode() || !pinSet()) return;
      if (document.hidden) hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > 120000 && !locked) { locked = true; pinEntry = ''; pinMsg = ''; render(); }
    }
    function shareLink(link, who) {
      share(`${data.settings.business} — staff attendance app${who ? ` for ${who}` : ''}.\n\nTap this link on your phone to set it up, then choose your own 4-digit PIN:\n${link}\n\nKeep this message private — anyone with the link can open the app.`);
    }
    function phoneCard() {
      const s = cloud.status();
      return `<section class="na-card na-pad" id="na-cloud"><h3 class="na-h3">This phone</h3>
        <p class="na-sync"><span class="na-dot ${s.ok ? 'ok' : 'bad'}"></span>${esc(s.text)}</p>
        <p class="na-hint">Locked with this phone's own PIN. The app locks itself after two minutes in the background.</p>
        <div class="na-actions"><button type="button" class="na-btn" data-a="cloud-sync">Sync now</button><button type="button" class="na-btn" data-a="pin-lock">Lock now</button><button type="button" class="na-btn" data-a="pin-change">Change PIN</button></div>
      </section>
      <section class="na-card na-pad"><h3 class="na-h3">Family phones</h3>
        <p class="na-hint">Everyone uses the same login, so every phone shows the same register and pay — whoever updates it, the others see it within a minute. To add a son's phone, send him the setup link: he taps it and chooses his own PIN.</p>
        <div class="na-actions"><button type="button" class="na-btn primary" data-a="my-link">Send the setup link</button></div>
        <p class="na-hint" style="margin-top:16px"><b>Phone lost or stolen?</b> Make a new link. Every other phone is signed out at once; send the new link to the phones that should keep using the app.</p>
        <div class="na-actions"><button type="button" class="na-btn danger-outline" data-a="new-link">Make a new link</button><button type="button" class="na-btn ghost" data-a="cloud-out">Remove this phone</button></div>
      </section>`;
    }
    if (cloud && cloud.onStatus) cloud.onStatus(() => {
      if (gated() !== wasGated) { wasGated = gated(); if (!el.querySelector('.na-modal.forced')) render(); return; }
      const b = el.querySelector('.na-brand i'); if (b) b.innerHTML = cloudLine();
      const line = el.querySelector('#na-cloud .na-sync');
      if (line) { const s = cloud.status(); line.innerHTML = `<span class="na-dot ${s.ok ? 'ok' : 'bad'}"></span>${esc(s.text)}`; }
    });

    /* ---------- saving ---------- */
    function save() {
      try { storage.save(data); }
      catch (e) { alert('Could not save — the browser storage is full. Download a backup under Settings.'); return; }
      if (typeof opts.onChange === 'function') opts.onChange(data);
    }

    const money = (n) => {
      const cur = data.settings.currency || '';
      const s = Math.abs(round2(n)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return (n < -0.004 ? '−' : '') + cur + (cur.length > 1 ? ' ' : '') + s;
    };
    const activeStaff = () => data.employees.filter((e) => e.active !== false).sort((a, b) => a.name.localeCompare(b.name));
    const empById = (id) => data.employees.find((e) => e.id === id);

    /* ---------- toast & modal ---------- */
    let toastTimer;
    function toast(msg) {
      let t = el.querySelector('.na-toast');
      if (!t) { t = document.createElement('div'); t.className = 'na-toast'; t.setAttribute('role', 'status'); el.appendChild(t); }
      t.textContent = msg; t.classList.add('on');
      clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2400);
    }
    function closeModal() { const m = el.querySelector('.na-modal-back'); if (m) m.remove(); }
    function modal(title, body, onSubmit, submit) {
      closeModal();
      el.insertAdjacentHTML('beforeend', `<div class="na-modal-back"><form class="na-modal" autocomplete="off">
        <header><h2>${esc(title)}</h2><button type="button" class="na-x" data-a="close" aria-label="Close">×</button></header>
        <div class="na-modal-body">${body}</div>
        ${onSubmit ? `<footer><button type="button" class="na-btn ghost" data-a="close">Cancel</button><button class="na-btn primary">${esc(submit || 'Save')}</button></footer>` : ''}
      </form></div>`);
      const form = el.querySelector('.na-modal');
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(form), out = {};
        for (const [k, v] of fd.entries()) { if (k in out) out[k] = [].concat(out[k], v); else out[k] = v; }
        if (onSubmit(out, form) !== false) closeModal();
      });
      const first = form.querySelector('input:not([type=hidden]):not([type=checkbox]),select,textarea');
      if (first) first.focus();
    }
    function field(label, name, value, o) {
      o = o || {};
      let input;
      if (o.options) input = `<select name="${name}">${o.options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
      else if (o.area) input = `<textarea name="${name}" rows="${o.area}" placeholder="${esc(o.ph || '')}">${esc(value)}</textarea>`;
      else input = `<input name="${name}" type="${o.type || 'text'}" ${o.type === 'number' ? 'step="any" min="0" inputmode="decimal"' : ''} value="${esc(value)}" placeholder="${esc(o.ph || '')}" ${o.req ? 'required' : ''}>`;
      return `<label class="na-fld ${o.cls || ''}"><span>${esc(label)}</span>${input}${o.hint ? `<i>${esc(o.hint)}</i>` : ''}</label>`;
    }

    /* ---------- sharing ---------- */
    function share(text) {
      if (navigator.share && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) { navigator.share({ text }).catch(() => {}); return; }
      window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
    }
    function copy(text) {
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('Copied — paste it into WhatsApp'), () => toast('Could not copy'));
    }

    /* ---------- layout ---------- */
    const TABS = [['today', 'Today', 'Today'], ['month', 'Month', 'Month'], ['pay', 'Pay', 'Pay'], ['staff', 'Staff', 'Staff'], ['settings', 'Settings', 'Settings']];
    const TAB_ICON = {
      today: '<path d="M8 3v3M16 3v3"/><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="m8.5 13 2.5 2.5 4.5-5"/>',
      month: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v3M16 3v3M8 14h.01M12 14h.01M16 14h.01M8 17.5h.01M12 17.5h.01"/>',
      pay: '<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10.5h18M7 15h3"/>',
      staff: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19.5c.4-3.3 2.600-5 5.500-5s5.100 1.700 5.500 5"/><path d="M16 5.600a3 3 0 0 1 0 5.800M17.800 14.800c1.600.700 2.500 2.200 2.700 4.700"/>',
      settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.500M12 18.500V21M3 12h2.500M18.500 12H21M5.600 5.600l1.800 1.800M16.600 16.600l1.800 1.800M5.600 18.400l1.800-1.800M16.600 7.400l1.800-1.800"/>',
    };
    const tabIcon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.800" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TAB_ICON[k]}</svg>`;
    function render() {
      wasGated = gated();
      if (wasGated) { closeModal(); gateScreen(); return; }
      el.innerHTML = `
        <header class="na-top">
          <div class="na-brand"><span class="na-logo">NMS</span><span><b>${esc(data.settings.business)}</b><i>${cloudLine()}</i></span></div>

        </header>
        <main class="na-main"></main>
          <nav class="na-tabs" aria-label="Sections">${TABS.map(([k, l, sh]) => `<button type="button" data-a="tab" data-k="${k}" class="${ui.tab === k ? 'on' : ''}" ${ui.tab === k ? 'aria-current="page"' : ''}>${tabIcon(k)}<span class="na-long">${l}</span><span class="na-short">${sh}</span></button>`).join('')}</nav>`;
      const main = el.querySelector('.na-main');
      if (!data.employees.length && ui.tab !== 'settings' && ui.tab !== 'staff') ui.tab = 'staff';
      ({ today: viewToday, month: viewMonth, pay: viewPay, staff: viewStaff, settings: viewSettings })[ui.tab](main);
      el.querySelectorAll('.na-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.k === ui.tab));
    }
    /* first sign-in with a temporary password: choose your own before anything else */
    function forcePassword() {
      if (!cloud || gated() || !cloud.status().mustChange || el.querySelector('.na-modal.forced')) return;
      modal('Choose your own password', `<p>You signed in with a temporary password. Choose your own now — only you will know it.</p>
        <div class="na-form">${field('New password (at least 8 characters)', 'pw', '', { type: 'password', req: true })}${field('Type it again', 'pw2', '', { type: 'password', req: true })}</div>`, (f, form) => {
        if (f.pw.length < 8) { toast('Use at least 8 characters'); return false; }
        if (f.pw !== f.pw2) { toast('The two passwords are not the same'); return false; }
        const btn = form.querySelector('footer .primary'); btn.disabled = true; btn.textContent = 'Saving…';
        cloud.setPassword(f.pw).then(() => { closeModal(); toast('Password saved'); render(); }, (e) => { btn.disabled = false; btn.textContent = 'Save password'; toast(e.message); });
        return false;
      }, 'Save password');
      const m = el.querySelector('.na-modal');
      m.classList.add('forced');
      m.querySelectorAll('[data-a="close"]').forEach((b) => b.remove());
      m.querySelector('input[type=password]').setAttribute('autocomplete', 'new-password');
    }

    /* ---------- daily register ---------- */
    const MAIN_MARKS = ['P', 'L', 'H', 'A'];
    const SHORT = { P: 'Present', L: 'Late', H: 'Half day', A: 'Absent', S: 'Sick', V: 'Leave', O: 'Day off' };
    function viewToday(main) {
      const d = ui.day, isToday = d === C.localToday();
      const sum = C.daySummary(data, d);
      const closed = data.closed[d];
      const staff = activeStaff();
      main.innerHTML = `
        <div class="na-dayhead">
          <button type="button" class="na-round" data-a="day" data-n="-1" aria-label="Previous day">‹</button>
          <label class="na-daytitle"><span>${isToday ? 'Today' : C.DAY_NAMES[C.dow(d)]}</span><b>${fmtDate(d)}</b><input type="date" value="${d}" data-a-change="day-pick" aria-label="Pick a date"></label>
          <button type="button" class="na-round" data-a="day" data-n="1" aria-label="Next day">›</button>
        </div>
        ${isToday ? '' : '<div class="na-center"><button type="button" class="na-btn sm ghost" data-a="day-today">Back to today</button></div>'}
        ${closed ? `<div class="na-card na-pad na-closed"><b>Shop closed — ${esc(closed)}</b><p>Nobody is expected. Salaries are not reduced; daily-rate staff are not paid for the day. Anyone who still came in can be marked below and is paid an extra day.</p></div>` : `
        <div class="na-tally">${STATUS_ORDER.filter((k) => sum.counts[k]).map((k) => `<span class="na-s s-${k}">${SHORT[k]} <b>${sum.counts[k]}</b></span>`).join('')}${sum.missing ? `<span class="na-s s-none">To mark <b>${sum.missing}</b></span>` : staff.length ? '<span class="na-s s-done">Everyone marked ✓</span>' : ''}</div>`}
        <div class="na-quick">
          ${closed ? '' : `<button type="button" class="na-btn primary" data-a="all-present" ${sum.missing ? '' : 'disabled'}>✓ Everyone else present</button>`}
          <button type="button" class="na-btn wa" data-a="share-day">WhatsApp</button>
          <button type="button" class="na-btn" data-a="closed">${closed ? 'Shop open after all' : 'Shop closed'}</button>
        </div>
        <section class="na-list">
          ${staff.length ? staff.map((e) => {
            const m = C.getMark(data, d, e.id) || {};
            const exp = C.expected(data, e, d);
            const extra = [num(m.ot) ? `+${num(m.ot)} h overtime` : '', m.note].filter(Boolean).map(esc).join(' · ');
            const moreOn = m.s && !MAIN_MARKS.includes(m.s);
            return `<div class="na-card na-row ${!exp && !m.s ? 'na-off' : ''}">
              <div class="na-who"><b>${esc(e.name)}</b><i>${esc(e.role || '')}${exp ? '' : `${e.role ? ' · ' : ''}${closed ? 'shop closed' : e.startDate > d ? 'not started yet' : 'day off'}`}${extra ? `${e.role || !exp ? ' · ' : ''}<em>${extra}</em>` : ''}</i></div>
              <div class="na-seg" role="group" aria-label="Attendance for ${esc(e.name)}">
                ${MAIN_MARKS.map((k) => `<button type="button" class="s-${k} ${m.s === k ? 'on' : ''}" data-a="mark" data-e="${e.id}" data-s="${k}" aria-pressed="${m.s === k}">${SHORT[k]}</button>`).join('')}
                <button type="button" class="na-more ${moreOn ? `on s-${m.s}` : ''}" data-a="mark-sheet" data-e="${e.id}" aria-label="More for ${esc(e.name)}">${moreOn ? SHORT[m.s] : 'More'}</button>
              </div>
            </div>`;
          }).join('') : '<div class="na-card"><div class="na-empty"><b>No staff yet.</b><p>Add your workers under Staff first.</p><button type="button" class="na-btn primary" data-a="tab" data-k="staff">Go to Staff</button></div></div>'}
        </section>
        <p class="na-hint na-center">Tap to mark, tap again to clear. <b>More</b> has sick, leave, day off, overtime and a note. Everything saves by itself.</p>`;
    }
    function markSheet(empId) {
      const e = empById(empId), m = C.getMark(data, ui.day, empId) || {};
      modal(`${e.name} — ${fmtDate(ui.day, true)}`, `
        <div class="na-moregrid">${['S', 'V', 'O'].map((k) => `<button type="button" class="na-morebtn s-${k} ${m.s === k ? 'on' : ''}" data-a="mark-more" data-e="${empId}" data-s="${k}">${STATUS[k].label}</button>`).join('')}
          <button type="button" class="na-morebtn" data-a="mark-more" data-e="${empId}" data-s="">Clear</button></div>
        <div class="na-form g2" style="margin-top:14px">
          ${field('Overtime (hours)', 'ot', num(m.ot) || '', { type: 'number', ph: '0' })}
          ${field('Note', 'note', m.note || '', { ph: 'e.g. taxi late, doctor' })}
        </div>`, (f) => {
        C.setMark(data, ui.day, empId, { ot: round2(num(f.ot)), note: (f.note || '').trim() });
        save(); render();
      }, 'Save');
    }

    /* ---------- month sheet ---------- */
    function viewMonth(main) {
      const [y, m] = ui.month.split('-').map(Number);
      const n = C.daysInMonth(y, m - 1);
      const days = Array.from({ length: n }, (_, i) => `${ui.month}-${String(i + 1).padStart(2, '0')}`);
      const staff = activeStaff();
      const now = C.localToday();
      main.innerHTML = `
        <div class="na-head">
          <div class="na-daynav">
            <button type="button" class="na-btn sm" data-a="month" data-n="-1" aria-label="Previous month">‹</button>
            <input type="month" class="na-date" value="${ui.month}" data-a-change="month-pick">
            <button type="button" class="na-btn sm" data-a="month" data-n="1" aria-label="Next month">›</button>
          </div>
          <div class="na-actions"><button type="button" class="na-btn" data-a="print-month">Print</button></div>
        </div>
        <h1 class="na-h1">${C.MONTHS[m - 1]} ${y}</h1>
        <section class="na-card na-scroll">
          <table class="na-grid">
            <thead><tr><th class="na-sticky">Employee</th>${days.map((d) => `<th class="${data.closed[d] ? 'cl' : ''} ${d === now ? 'td' : ''}" title="${data.closed[d] ? esc(data.closed[d]) : ''}"><i>${C.DAY_NAMES[C.dow(d)][0]}</i>${+d.slice(8)}</th>`).join('')}<th>Present</th><th>Late</th><th>Half</th><th>Absent</th><th>Sick/leave</th><th>OT h</th></tr></thead>
            <tbody>${staff.map((e) => {
              const t = { P: 0, L: 0, H: 0, A: 0, SV: 0, ot: 0 };
              const cells = days.map((d) => {
                const mk = C.getMark(data, d, e.id);
                const exp = C.expected(data, e, d);
                if (mk) { t.ot += num(mk.ot); if (mk.s === 'S' || mk.s === 'V') t.SV++; else if (t[mk.s] !== undefined) t[mk.s]++; }
                const s = mk && mk.s;
                const missing = !s && exp && d <= now && d >= (data.settings.since || '');
                return `<td class="c ${s ? 's-' + s : ''} ${!exp && !s ? 'off' : ''} ${missing ? 'miss' : ''}" data-a="cell" data-e="${e.id}" data-d="${d}" title="${esc(fmtDate(d, true))}: ${s ? STATUS[s].label : missing ? 'not marked' : exp ? '' : 'not expected'}${mk && mk.note ? ' — ' + esc(mk.note) : ''}">${s || (missing ? '·' : '')}</td>`;
              }).join('');
              return `<tr><th class="na-sticky">${esc(e.name)}</th>${cells}<td class="t">${t.P + t.L}</td><td class="t">${t.L}</td><td class="t">${t.H}</td><td class="t ${t.A ? 'bad' : ''}">${t.A}</td><td class="t">${t.SV}</td><td class="t">${round2(t.ot) || ''}</td></tr>`;
            }).join('')}</tbody>
          </table>
        </section>
        <p class="na-hint">Tap a square to change it: Present → Late → Half day → Absent → Sick → Leave → Day off → clear. A dot means a working day nobody has marked yet. Grey columns are days the shop was closed.</p>
        <div class="na-legend">${STATUS_ORDER.map((k) => `<span><b class="c s-${k}">${k}</b>${STATUS[k].label}</span>`).join('')}</div>`;
    }

    /* ---------- pay ---------- */
    /* ---------- pay: a running account per person — pay any amount, any day ---------- */
    function scheduleText(e) {
      const amt = e.payType === 'daily' ? `${money(num(e.rate))} a day` : e.schedule === 'monthdays' || e.schedule === 'monthly' ? `${money(num(e.rate))} a month`
        : e.schedule === 'weekly' ? `${money(num(e.rate))} a week` : `${money(num(e.rate))} every two weeks`;
      return `${amt} · paid ${payDayText(e)}`;
    }
    /* whole rands without the cents, so the at-a-glance table fits on a phone */
    const moneyC = (n) => (Math.abs(n - Math.round(n)) < 0.005 ? money(Math.round(n)).replace(/\.00$/, '') : money(n));
    const owedText = (a) => (a.owed > 0.004 ? moneyC(a.owed) : a.owed < -0.004 ? `${moneyC(-a.owed)} ahead` : 'Paid up ✓');
    function viewPay(main) {
      const now = C.localToday();
      const rows = activeStaff().map((e) => ({ e, a: C.account(data, e, now) }));
      const t = rows.reduce((x, { a }) => ({ earned: x.earned + a.earned, paid: x.paid + a.paid, owed: x.owed + Math.max(0, a.owed), month: x.month + a.paidThisMonth }), { earned: 0, paid: 0, owed: 0, month: 0 });
      const next = rows.filter(({ a }) => a.current).sort((x, y) => x.a.current.end.localeCompare(y.a.current.end))[0];
      main.innerHTML = `
        <h1 class="na-h1">Pay</h1>
        ${rows.length ? `<section class="na-card na-totals">
          <div class="na-card-head"><h3 class="na-h3">Everyone at a glance</h3><span class="na-hint">Tap a name for details</span></div>
          <div class="na-scroll"><table class="na-sum"><thead><tr><th>Name</th><th class="r">Earned</th><th class="r">Paid</th><th class="r">To pay</th></tr></thead><tbody>
          ${rows.map(({ e, a }) => {
            const pct = a.earned > 0 ? Math.min(100, Math.round((a.paid / a.earned) * 100)) : a.paid > 0 ? 100 : 0;
            return `<tr data-a="pay-jump" data-e="${e.id}"><td><b>${esc(e.name)}</b><span class="na-bar" title="${pct}% paid"><i style="width:${pct}%"></i></span></td>
              <td class="r">${moneyC(a.earned)}</td><td class="r">${moneyC(a.paid)}</td><td class="r ${a.owed > 0.004 ? 'owe' : 'ok'}"><b>${owedText(a)}</b></td></tr>`;
          }).join('')}</tbody>
          <tfoot><tr><td>Total</td><td class="r">${moneyC(t.earned)}</td><td class="r">${moneyC(t.paid)}</td><td class="r owe">${moneyC(t.owed)}</td></tr></tfoot></table></div>
          <p class="na-hint na-pad-x">Earned = every pay day so far${data.settings.since ? `, since ${fmtDate(data.settings.since)}` : ''}. Paid = everything handed over, on pay day or in between.</p>
        </section>
        <div class="na-stats na-stats-pay">
          <div class="na-stat hero"><span>Still to pay now</span><b>${money(t.owed)}</b><i>${rows.filter(({ a }) => a.owed > 0.004).length} of ${rows.length} people owed money</i></div>
          <div class="na-stat"><span>Paid this month</span><b>${money(t.month)}</b><i>${C.MONTHS[+now.slice(5, 7) - 1]} ${now.slice(0, 4)}</i></div>
          ${next ? `<div class="na-stat"><span>Next pay day</span><b>${fmtDate(next.a.current.end).replace(/ \d{4}$/, '')}</b><i>${esc(next.e.name)} · ${money(next.a.nextPay)}</i></div>` : ''}
        </div>
        ${rows.map(({ e, a }) => payCard(e, a)).join('')}` : '<section class="na-card"><div class="na-empty"><b>No staff yet.</b><p>Add your workers under Staff.</p></div></section>'}
        <p class="na-hint">Pay any amount on any day — on pay day, part of it, or in between. It all comes off what they have earned, and paying early simply lowers the next pay. Fixed salary: absent and half days come off at salary ÷ working days in the period. Daily rate: only days marked Present, Late, Sick or Leave are paid.</p>`;
    }
    function payCard(e, a) {
      const r = a.current;
      const pct = a.earned > 0 ? Math.min(100, Math.round((a.paid / a.earned) * 100)) : a.paid > 0 ? 100 : 0;
      const c = r ? r.counts : null;
      const pill = a.owed > 0.004 ? `<span class="na-pill bad">To pay ${money(a.owed)}</span>` : a.owed < -0.004 ? `<span class="na-pill">${money(-a.owed)} ahead</span>` : '<span class="na-pill ok">Paid up ✓</span>';
      return `<section class="na-card na-pay" id="pay-${e.id}">
        <div class="na-pay-head"><div><b>${esc(e.name)}</b><i>${esc(e.role ? e.role + ' · ' : '')}${scheduleText(e)}</i></div>${pill}</div>
        <div class="na-acct">
          <div><span>Earned</span><b>${money(a.earned)}</b></div>
          <div><span>Paid</span><b>${money(a.paid)}</b></div>
          <div class="${a.owed > 0.004 ? 'owe' : 'ok'}"><span>${a.owed < -0.004 ? 'Paid ahead' : 'To pay now'}</span><b>${money(Math.abs(a.owed))}</b></div>
        </div>
        <div class="na-pad-x"><span class="na-bar big" title="${pct}% of earnings paid"><i style="width:${pct}%"></i></span></div>
        ${r ? `<p class="na-next na-pad-x">Next pay day <b>${fmtDate(r.end, true)}</b>${r.daysToPay === 0 ? ' (today)' : r.daysToPay === 1 ? ' (tomorrow)' : ` (in ${r.daysToPay} days)`}: <b>${money(a.nextPay)}</b>
          <span class="na-hint">${a.owed > 0.004 ? `${money(a.owed)} still owed + ` : a.owed < -0.004 ? `${money(r.earned)} this period − ${money(-a.owed)} paid ahead` : ''}${a.owed > 0.004 || Math.abs(a.owed) <= 0.004 ? `${money(r.earned)} this period${c.upcoming ? (e.payType === 'daily' ? ' so far' : ', if nobody is absent') : ''}` : ''}</span></p>` : ''}
        ${r ? `<details class="na-more-info na-pad-x"><summary>This period: ${fmtDate(r.start)} – ${fmtDate(r.end)}</summary>
          <div class="na-counts"><span class="s-P">Present <b>${c.P + c.L}</b></span>${c.L ? `<span class="s-L">Late <b>${c.L}</b></span>` : ''}<span class="s-H">Half <b>${c.H}</b></span><span class="s-A">Absent <b>${c.A}</b></span>${c.S ? `<span class="s-S">Sick <b>${c.S}</b></span>` : ''}${c.V ? `<span class="s-V">Leave <b>${c.V}</b></span>` : ''}${c.extra ? `<span>Extra days <b>${c.extra}</b></span>` : ''}${c.otHours ? `<span>Overtime <b>${round2(c.otHours)} h</b></span>` : ''}</div>
          ${c.unrecorded ? `<p class="na-warn">${c.unrecorded} working day(s) not marked yet: ${r.unrecordedDates.slice(0, 6).map((d) => `<a href="#" data-a="goto-day" data-d="${d}">${fmtDate(d, true)}</a>`).join(', ')}${r.unrecordedDates.length > 6 ? '…' : ''}</p>` : ''}
          <table class="na-lines">${r.lines.filter((l) => l.kind !== 'adv').map((l) => `<tr><td>${esc(l.label)}</td><td class="${l.amount < 0 ? 'neg' : ''}">${money(l.amount)}</td></tr>`).join('')}
            <tr class="tot"><td>Earned this period</td><td>${money(r.earned)}</td></tr></table></details>` : ''}
        <details class="na-more-info na-pad-x"><summary>Payments (${a.payments.length})${a.payments.length ? ` · last ${fmtDate(a.payments[0].date)}` : ''}</summary>
          ${a.payments.length ? `<table class="na-lines">${a.payments.slice(0, 40).map((x) => `<tr><td>${fmtDate(x.date, true)}<span class="na-hint"> · ${esc(x.method || 'Paid')}${x.note ? ' · ' + esc(x.note) : ''}</span></td><td>${money(x.amount)}</td><td class="na-del"><button type="button" class="na-x sm" data-a="del-pay" data-id="${x.id}" data-k="${x.kind}" aria-label="Remove this payment">×</button></td></tr>`).join('')}</table>` : '<p class="na-hint">Nothing paid yet.</p>'}
        </details>
        <div class="na-pay-foot">
          <button type="button" class="na-btn sm" data-a="slip" data-e="${e.id}">Pay slip</button>
          <button type="button" class="na-btn sm wa" data-a="share-slip" data-e="${e.id}">WhatsApp</button>
          <button type="button" class="na-btn primary" data-a="pay" data-e="${e.id}">Pay ${esc(e.name.split(' ')[0])}</button>
        </div>
      </section>`;
    }
    /* the period a pay slip is for: the last one whose pay day has come, else the current one */
    function slipFor(empId) {
      const e = empById(empId), a = C.account(data, e, C.localToday());
      return { e, a, r: a.periods[a.periods.length - 1] || a.current };
    }
    function payModal(empId) {
      const e = empById(empId), a = C.account(data, e, C.localToday());
      const sugg = [];
      if (a.owed > 0.004) sugg.push(['Still owed', a.owed]);
      if (a.current && a.nextPay > 0.004 && Math.abs(a.nextPay - a.owed) > 0.004) sugg.push([`Up to ${fmtDate(a.current.end).replace(/ \d{4}$/, '')}`, a.nextPay]);
      modal(`Pay ${e.name}`, `
        <div class="na-acct small"><div><span>Earned</span><b>${money(a.earned)}</b></div><div><span>Paid</span><b>${money(a.paid)}</b></div><div class="${a.owed > 0.004 ? 'owe' : 'ok'}"><span>${a.owed < -0.004 ? 'Paid ahead' : 'To pay now'}</span><b>${money(Math.abs(a.owed))}</b></div></div>
        ${sugg.length ? `<div class="na-chips">${sugg.map(([l, v]) => `<button type="button" class="na-btn sm" data-a="pay-fill" data-v="${round2(v)}">${l}: ${money(v)}</button>`).join('')}</div>` : ''}
        <div class="na-form g2" style="margin-top:12px">
          ${field('Amount', 'net', a.owed > 0.004 ? round2(a.owed) : '', { type: 'number', req: true, ph: '0.00' })}
          ${field('Date', 'paidOn', C.localToday(), { type: 'date' })}
          ${field('How', 'method', 'Cash', { options: [['Cash', 'Cash'], ['Bank transfer', 'Bank transfer'], ['EFT', 'EFT'], ['Other', 'Other']] })}
          ${field('Note (optional)', 'note', '', { ph: 'e.g. part of wages, advance' })}
        </div>
        <p class="na-hint">Any amount, any day: part of the wages, the full amount, or money in between pay days. It comes off what is owed; paying more than is owed now lowers the next pay.</p>`, (f) => {
        if (num(f.net) <= 0) { toast('Enter an amount'); return false; }
        data.payments.push({ id: C.uid(), empId: e.id, paidOn: f.paidOn || C.localToday(), method: f.method, note: (f.note || '').trim(), net: round2(num(f.net)) });
        save(); toast(`${money(num(f.net))} paid to ${e.name}`); render();
        const card = el.querySelector('#pay-' + e.id); if (card) card.scrollIntoView({ block: 'nearest' });
      }, 'Record payment');
    }

    /* pay slip, printed on its own page */
    function printSlip(empId) {
      const { e, a, r } = slipFor(empId);
      if (!r) { toast('No pay period yet'); return; }
      const c = r.counts, s = data.settings;
      const paidIn = a.payments.filter((x) => x.date >= r.start && x.date <= C.addDays(r.end, 6)).slice().reverse();
      printHTML(`<div class="nap-slip">
        <header><div><h1>${esc(s.business)}</h1>${s.phone ? `<p>${esc(s.phone)}</p>` : ''}</div><div class="r"><h2>Pay slip</h2><p>${fmtDate(r.start)} – ${fmtDate(r.end)}</p></div></header>
        <table class="kv"><tr><th>Employee</th><td>${esc(e.name)}</td><th>Role</th><td>${esc(e.role || '—')}</td></tr>
          <tr><th>ID no</th><td>${esc(e.idNo || '—')}</td><th>Paid</th><td>${esc(payDayText(e))}</td></tr></table>
        <h3>Attendance</h3>
        <table class="kv"><tr><th>Working days</th><td>${c.expected}</td><th>Present</th><td>${c.P + c.L}${c.L ? ` (late ${c.L})` : ''}</td></tr>
          <tr><th>Half days</th><td>${c.H}</td><th>Absent</th><td>${c.A}</td></tr>
          <tr><th>Sick / leave</th><td>${c.S} / ${c.V}</td><th>Overtime</th><td>${round2(c.otHours)} h</td></tr></table>
        <h3>Earned</h3>
        <table class="lines">${r.lines.filter((l) => l.kind !== 'adv').map((l) => `<tr><td>${esc(l.label)}</td><td>${money(l.amount)}</td></tr>`).join('')}
          <tr class="tot"><td>Earned this period</td><td>${money(round2(r.gross - r.latePen))}</td></tr></table>
        <h3>Paid</h3>
        <table class="lines">${paidIn.map((x) => `<tr><td>${fmtDate(x.date)} · ${esc(x.method || 'Paid')}${x.note ? ' — ' + esc(x.note) : ''}</td><td>${money(x.amount)}</td></tr>`).join('') || '<tr><td>Nothing paid in this period</td><td></td></tr>'}</table>
        <h3>Account</h3>
        <table class="lines"><tr><td>Earned in total</td><td>${money(a.earned)}</td></tr><tr><td>Paid in total</td><td>${money(a.paid)}</td></tr>
          <tr class="tot"><td>${a.owed < -0.004 ? 'Paid ahead' : 'Still to pay'}</td><td>${money(Math.abs(a.owed))}</td></tr></table>
        <div class="sign"><div>Employer</div><div>Employee — received</div></div>
      </div>`, `Pay slip ${e.name} ${r.end}`);
    }
    function printMonth() {
      const tbl = el.querySelector('.na-grid');
      printHTML(`<div class="nap-month"><h1>${esc(data.settings.business)} — attendance ${el.querySelector('.na-h1').textContent}</h1>${tbl.outerHTML}
        <p>${STATUS_ORDER.map((k) => `${k} = ${STATUS[k].label}`).join(' · ')}</p></div>`, 'Attendance ' + ui.month, true);
    }
    function printHTML(html, title, landscape) {
      let p = document.querySelector('.nms-print');
      if (!p) { p = document.createElement('div'); p.className = 'nms-print'; document.body.appendChild(p); }
      p.innerHTML = html;
      p.classList.toggle('landscape', !!landscape);
      document.body.classList.add('nms-printing');
      const old = document.title; document.title = title;
      setTimeout(() => {
        window.print();
        document.title = old;
        document.body.classList.remove('nms-printing');
      }, 50);
    }

    /* ---------- staff ---------- */
    function viewStaff(main) {
      const now = C.localToday();
      const list = data.employees.slice().sort((a, b) => (b.active !== false) - (a.active !== false) || a.name.localeCompare(b.name));
      main.innerHTML = `
        <div class="na-head"><h1 class="na-h1">Staff</h1><button type="button" class="na-btn primary" data-a="emp">+ Add employee</button></div>
        <section class="na-card">${list.length ? `<table class="na-tbl"><thead><tr><th>Name</th><th>Pay</th><th>Paid</th><th>Next pay day</th><th></th></tr></thead><tbody>
          ${list.map((e) => `<tr data-a="emp" data-id="${e.id}" class="${e.active === false ? 'na-off' : ''}">
            <td><b>${esc(e.name)}</b><i>${esc([e.role, e.phone].filter(Boolean).join(' · '))}${e.active === false ? ' · no longer working here' : ''}</i></td>
            <td>${money(num(e.rate))} <i>${e.payType === 'daily' ? 'a day' : 'salary'}</i></td>
            <td>${C.SCHEDULES[e.schedule]}<i>${payDayText(e)}</i></td>
            <td>${e.active === false ? '—' : fmtDate(C.nextPayDay(e, now), true)}</td>
            <td class="r"><button type="button" class="na-btn sm" data-a="pay" data-e="${e.id}">Pay</button></td></tr>`).join('')}
          </tbody></table>` : `<div class="na-empty"><b>Add your staff to start.</b><p>For each person: their name, how much they earn, and when they are paid (monthly, on set dates like the 10th, 20th and 30th, every two weeks or weekly). Then mark attendance each day instead of sending it on WhatsApp — pay works itself out.</p><button type="button" class="na-btn primary" data-a="emp">+ Add employee</button></div>`}</section>`;
    }
    function payDayText(e) {
      if (e.schedule === 'monthly') return num(e.payDay) >= 31 ? 'on the last day of the month' : `on the ${ordinal(num(e.payDay))}`;
      if (e.schedule === 'monthdays') { const d = C.payDaysOf(e).map((x) => (x >= 31 ? 'last day' : ordinal(x))); return 'on the ' + (d.length > 1 ? d.slice(0, -1).join(', ') + ' & ' + d[d.length - 1] : d[0]); }
      return `on ${C.DAY_NAMES[num(e.payDay) % 7]}s`;
    }
    const ordinal = (n) => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');

    function employeeModal(id) {
      const e = empById(id) || C.blankEmployee();
      const days = C.DAY_NAMES.map((n, i) => [i, n]);
      const monthDays = Array.from({ length: 30 }, (_, i) => [i + 1, ordinal(i + 1)]).concat([[31, 'Last day of the month']]);
      modal(id ? `Edit ${e.name}` : 'Add employee', `
        <div class="na-form g2">
          ${field('Full name', 'name', e.name, { req: true })}
          ${field('Job / role', 'role', e.role, { ph: 'e.g. Counter sales, Driver' })}
          ${field('Phone', 'phone', e.phone, { type: 'tel' })}
          ${field('ID number (optional)', 'idNo', e.idNo)}
          ${field('Started on (only for someone new)', 'startDate', e.startDate, { type: 'date', hint: 'Leave empty if they already worked here.' })}
          ${field('Paid', 'schedule', e.schedule, { options: Object.entries(C.SCHEDULES) })}
          ${field('How pay is worked out', 'payType', e.payType, { options: Object.entries(C.PAY_TYPES), cls: 'span2' })}
          ${field(e.payType === 'daily' ? 'Rate per day' : 'Salary per pay period', 'rate', num(e.rate) || '', { type: 'number', req: true, hint: 'Monthly → the monthly salary. Weekly → the weekly wage. Daily rate → the amount for one day.' })}
          <label class="na-fld" data-pd="monthly" ${e.schedule === 'monthly' ? '' : 'hidden'}><span>Pay day</span><select name="payDayM">${monthDays.map(([v, l]) => `<option value="${v}" ${e.schedule === 'monthly' && +e.payDay === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="na-fld" data-pd="monthdays" ${e.schedule === 'monthdays' ? '' : 'hidden'}><span>Pay dates each month</span><input name="payDays" inputmode="numeric" value="${esc(C.payDaysOf(e).join(', '))}" placeholder="10, 20, 30"><i>Days of the month, e.g. 10, 20, 30. The monthly salary is split evenly over them; 30 or 31 means month-end in short months.</i></label>
          <label class="na-fld" data-pd="week" ${e.schedule === 'weekly' || e.schedule === 'fortnightly' ? '' : 'hidden'}><span>Pay day</span><select name="payDayW">${days.map(([v, l]) => `<option value="${v}" ${(e.schedule === 'weekly' || e.schedule === 'fortnightly') && +e.payDay === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="na-fld span2" data-pd="fortnightly" ${e.schedule === 'fortnightly' ? '' : 'hidden'}><span>One recent or upcoming pay date</span><input type="date" name="anchor" value="${esc(e.anchor)}"><i>So the app knows which week the two-week cycle ends on.</i></label>
          <div class="na-fld span2"><span>Normal working days</span><div class="na-days">${days.map(([v, l]) => `<label><input type="checkbox" name="workDays" value="${v}" ${(e.workDays || []).includes(v) ? 'checked' : ''}>${l.slice(0, 3)}</label>`).join('')}</div></div>
          ${field('Overtime pay per hour', 'otRate', num(e.otRate) || '', { type: 'number', ph: '0' })}
          ${field('Deduct per late arrival', 'lateDeduct', num(e.lateDeduct) || '', { type: 'number', ph: '0 = just count it' })}
          ${field('Already owed to them when you started (optional)', 'opening', num(e.opening) || '', { ph: '0', cls: 'span2', hint: 'Wages from before you started using the app that are still unpaid. Use a minus sign if they owe the shop (e.g. −500).' })}
          ${id ? `<label class="na-check span2"><input type="checkbox" name="left" ${e.active === false ? 'checked' : ''}> No longer works here (kept in old records, hidden from the register)</label>` : ''}
          ${field('Notes', 'notes', e.notes, { area: 2, cls: 'span2' })}
        </div>
        ${id ? '<button type="button" class="na-btn danger" data-a="del-emp" data-id="' + id + '">Delete employee and their records</button>' : ''}`,
      (f) => {
        if (!f.name.trim()) { toast('Enter a name'); return false; }
        const wd = [].concat(f.workDays || []).map(Number);
        if (!wd.length) { toast('Pick at least one working day'); return false; }
        const rec = empById(id) || { ...C.blankEmployee(), id: C.uid() };
        Object.assign(rec, {
          name: f.name.trim(), role: f.role.trim(), phone: f.phone.trim(), idNo: f.idNo.trim(), startDate: f.startDate || '',
          schedule: f.schedule, payType: f.payType, rate: round2(num(f.rate)),
          payDay: f.schedule === 'monthly' ? num(f.payDayM) : num(f.payDayW), anchor: f.schedule === 'fortnightly' ? f.anchor || '' : '',
          payDays: C.payDaysOf({ payDays: f.payDays }), opening: round2(parseFloat(String(f.opening || '0').replace(/[−–]/g, '-')) || 0),
          workDays: wd, otRate: round2(num(f.otRate)), lateDeduct: round2(num(f.lateDeduct)), notes: f.notes || '',
          active: !f.left, endDate: f.left ? rec.endDate || C.localToday() : '',
        });
        if (!id) data.employees.push(rec);
        save(); toast(id ? 'Saved' : `${rec.name} added`); render();
      }, id ? 'Save' : 'Add employee');
      const form = el.querySelector('.na-modal');
      const sync = () => {
        const sch = form.schedule.value;
        form.querySelector('[data-pd="monthly"]').hidden = sch !== 'monthly';
        form.querySelector('[data-pd="week"]').hidden = sch !== 'weekly' && sch !== 'fortnightly';
        form.querySelector('[data-pd="monthdays"]').hidden = sch !== 'monthdays';
        form.querySelector('[data-pd="fortnightly"]').hidden = sch !== 'fortnightly';
        form.rate.closest('.na-fld').firstElementChild.textContent = form.payType.value === 'daily' ? 'Rate per day' : sch === 'monthly' || sch === 'monthdays' ? 'Salary per month' : sch === 'weekly' ? 'Wage per week' : 'Pay per two weeks';
      };
      form.addEventListener('change', sync); sync();
    }

    /* ---------- settings ---------- */
    function viewSettings(main) {
      const s = data.settings;
      main.innerHTML = `
        <h1 class="na-h1">Settings</h1>
        ${cloud ? cloudCard() : ''}
        <section class="na-card na-pad"><h3 class="na-h3">Business</h3>
          <form class="na-form g2" data-form="settings">
            ${field('Business name', 'business', s.business, { req: true })}
            ${field('Currency symbol', 'currency', s.currency, { ph: 'R' })}
            ${field('Phone (printed on pay slips)', 'phone', s.phone)}
            ${field('Attendance kept here since', 'since', s.since, { type: 'date', hint: 'Unmarked days before this date are not flagged as missing.' })}
          </form></section>
        <section class="na-card na-pad"><h3 class="na-h3">Shop closed days</h3>
          ${Object.keys(data.closed).length ? `<table class="na-lines">${Object.keys(data.closed).sort().reverse().slice(0, 12).map((d) => `<tr><td>${fmtDate(d, true)}</td><td>${esc(data.closed[d])}</td><td><button type="button" class="na-x sm" data-a="del-closed" data-d="${d}" aria-label="Remove">×</button></td></tr>`).join('')}</table>` : '<p class="na-hint">None yet. Use “Shop closed” on the daily register for public holidays and days the shop does not open.</p>'}
        </section>
        <section class="na-card na-pad"><h3 class="na-h3">Backup</h3>
          <p class="na-hint">Everything is saved in this browser on this device. Download a backup regularly and keep it somewhere safe (e-mail it to yourself, or save it to Google Drive).</p>
          <div class="na-actions"><button type="button" class="na-btn primary" data-a="export">Download backup</button>
          <label class="na-btn">Restore from backup<input type="file" accept=".json,application/json" data-a-change="import" hidden></label></div>
        </section>`;
      main.querySelector('[data-form="settings"]').addEventListener('input', (ev) => {
        const t = ev.target;
        data.settings[t.name] = t.value;
        save();
        if (t.name === 'since') return;
        if (t.name === 'business') el.querySelector('.na-brand b').textContent = t.value;
      });
    }
    function exportBackup() {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
      a.download = `${(data.settings.business || 'attendance').replace(/[^\w]+/g, '-').toLowerCase()}-attendance-${C.localToday()}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast('Backup downloaded');
    }
    function importBackup(file) {
      if (!file) return;
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const j = JSON.parse(rd.result);
          if (j.app !== 'nms-attendance' || !Array.isArray(j.employees)) throw new Error('bad');
          if (!confirm(`Restore this backup (${j.employees.length} employees)? It replaces everything currently here.`)) return;
          data = C.normalise(j); save(); toast('Backup restored'); render();
        } catch (e) { toast('That file is not an attendance backup'); }
      };
      rd.readAsText(file);
    }

    /* ---------- events ---------- */
    const MONTH_CYCLE = ['P', 'L', 'H', 'A', 'S', 'V', 'O', ''];
    const ACT = {
      close: () => closeModal(),
      tab: (t) => { ui.tab = t.dataset.k; render(); },
      day: (t) => { ui.day = addDays(ui.day, +t.dataset.n); render(); },
      'day-today': () => { ui.day = C.localToday(); render(); },
      'goto-day': (t, e) => { e.preventDefault(); ui.day = t.dataset.d; ui.tab = 'today'; render(); },
      'mark-sheet': (t) => markSheet(t.dataset.e),
      'mark-more': (t) => {
        const form = t.closest('form');
        const patch = { s: t.dataset.s };
        if (form) { patch.ot = round2(num(form.ot.value)); patch.note = form.note.value.trim(); }
        C.setMark(data, ui.day, t.dataset.e, patch);
        save(); closeModal(); render();
      },
      mark: (t) => {
        const cur = C.getMark(data, ui.day, t.dataset.e);
        C.setMark(data, ui.day, t.dataset.e, { s: cur && cur.s === t.dataset.s ? '' : t.dataset.s });
        save(); render();
      },
      'all-present': () => {
        let n = 0;
        for (const e of activeStaff()) {
          const m = C.getMark(data, ui.day, e.id);
          if ((!m || !m.s) && C.expected(data, e, ui.day)) { C.setMark(data, ui.day, e.id, { s: 'P' }); n++; }
        }
        save(); toast(`${n} marked present`); render();
      },
      closed: () => {
        if (data.closed[ui.day]) { delete data.closed[ui.day]; save(); render(); return; }
        modal('Shop closed', `${field('Reason', 'reason', 'Public holiday', { req: true, ph: 'e.g. Public holiday, Eid, stock-take' })}
          <p class="na-hint">Nobody is expected on ${fmtDate(ui.day, true)}. Salaries are not reduced; daily-rate staff are not paid for the day.</p>`,
        (f) => { data.closed[ui.day] = f.reason.trim() || 'Closed'; save(); render(); }, 'Mark as closed');
      },
      'share-day': () => share(C.dayText(data, ui.day)),
      month: (t) => { const [y, m] = ui.month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + +t.dataset.n, 1)); ui.month = d.toISOString().slice(0, 7); render(); },
      cell: (t) => {
        const cur = (C.getMark(data, t.dataset.d, t.dataset.e) || {}).s || '';
        C.setMark(data, t.dataset.d, t.dataset.e, { s: MONTH_CYCLE[(MONTH_CYCLE.indexOf(cur) + 1) % MONTH_CYCLE.length] });
        save(); render();
      },
      'print-month': () => printMonth(),
      pay: (t) => payModal(t.dataset.e),
      'pay-fill': (t) => { const i = el.querySelector('.na-modal [name=net]'); if (i) { i.value = t.dataset.v; i.focus(); } },
      'pay-jump': (t) => { const c = el.querySelector('#pay-' + t.dataset.e); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
      'del-pay': (t) => {
        if (!confirm('Remove this payment? The amount goes back to "to pay".')) return;
        if (t.dataset.k === 'adv') data.advances = data.advances.filter((x) => x.id !== t.dataset.id);
        else data.payments = data.payments.filter((x) => x.id !== t.dataset.id);
        save(); render();
      },

      slip: (t) => printSlip(t.dataset.e),
      'share-slip': (t) => { const { e, a, r } = slipFor(t.dataset.e); if (!r) return; share(C.payText(data, e, r, money, a)); },
      advance: (t) => payModal(t.dataset.e),

      emp: (t) => employeeModal(t.dataset.id),
      'del-emp': (t) => {
        const e = empById(t.dataset.id);
        if (!confirm(`Delete ${e.name} and all of their attendance, advances and pay records? To keep the history, tick "No longer works here" instead.`)) return;
        data.employees = data.employees.filter((x) => x.id !== e.id);
        for (const d of Object.keys(data.marks)) C.setMark(data, d, e.id, { s: '', ot: 0, note: '' });
        data.advances = data.advances.filter((x) => x.empId !== e.id);
        data.payments = data.payments.filter((x) => x.empId !== e.id);
        save(); closeModal(); render();
      },
      'del-closed': (t) => { delete data.closed[t.dataset.d]; save(); render(); },
      export: () => exportBackup(),
      'cloud-in': async (t) => {
        const email = el.querySelector('#na-email').value, pw = el.querySelector('#na-pass').value;
        if (!email || !pw) { toast('Enter your username and password'); return; }
        if (t.disabled) return;
        t.disabled = true; t.textContent = 'Signing in…';
        try { await cloud.signIn(email, pw); toast('Signed in — records are shared'); ui.tab = 'today'; data = C.normalise(storage.load()); render(); forcePassword(); }
        catch (e) { t.disabled = false; t.textContent = 'Sign in'; toast(e.message); }
      },
      'cloud-out': async () => {
        if (opts.requireSignIn) {
          await cloud.run();
          const n = cloud.pending ? cloud.pending() : 0;
          if (!confirm(n ? `${n} change(s) on this phone have not reached the cloud yet — probably no signal. If you remove this phone now they are lost. Remove it anyway?`
            : 'Remove this phone? The shop\'s records are taken off this phone but stay safe in the cloud. To use it again, tap the setup link.')) return;
          cloud.signOut(); cloud.clearLocal(); clearPin(); locked = false; data = C.normalise(null); ui.tab = 'today'; render();
          return;
        }
        if (!confirm('Sign out on this phone? The records stay on this phone and in the cloud.')) return;
        cloud.signOut(); render();
      },
      'cloud-sync': () => { cloud.run(); toast('Syncing…'); },
      'pin-key': async (t) => {
        if (pinBusy) return;
        const k = t.dataset.k;
        if (k === '⌫') { pinEntry = pinEntry.slice(0, -1); pinMsg = ''; render(); return; }
        if (pinEntry.length >= 4) return;
        pinEntry += k; pinMsg = ''; render();
        if (pinEntry.length < 4) return;
        const entered = pinEntry;
        pinBusy = true;
        try {
          if (!pinSet()) {
            pinEntry = '';
            if (!pinFirst) { pinFirst = entered; render(); return; }
            if (entered !== pinFirst) { pinFirst = ''; pinMsg = 'The two PINs were not the same — choose again'; render(); return; }
            await savePin(entered); pinFirst = ''; locked = false; render(); toast('PIN saved'); cloud.run(); return;
          }
          const ok = await checkPin(entered);
          pinEntry = '';
          if (ok === true) { locked = false; data = C.normalise(storage.load()); render(); cloud.run(); }
          else { pinMsg = ok === 'wait' ? 'Too many wrong tries — wait a minute, then try again' : 'Wrong PIN'; render(); }
        } finally { pinBusy = false; }
      },
      'pin-forgot': () => modal('Forgot your PIN?', '<p>Open WhatsApp on this phone and tap your <b>setup link</b> again — you can then choose a new PIN. Nothing is lost; the records are safe in the cloud.</p><p class="na-hint">Lost the link? Nazeer can send a new one from Settings → Phones.</p>', null),
      'pin-lock': () => { locked = true; pinEntry = ''; pinMsg = ''; render(); },
      'pin-change': () => { if (!confirm('Choose a new PIN for this phone?')) return; clearPin(); pinFirst = ''; pinEntry = ''; pinMsg = ''; locked = false; render(); },
      'my-link': () => shareLink(cloud.ownLink()),
      'new-link': async (t) => {
        if (!confirm('Make a new setup link? Every other phone is signed out straight away (this one stays on). Then send the new link to the phones that should keep using the app.')) return;
        t.disabled = true;
        try { const link = await cloud.resetOwn(); toast('New link made — the old one no longer works'); shareLink(link); }
        catch (e) { toast(e instanceof TypeError ? 'No internet connection' : e.message); }
        t.disabled = false;
      },
      'member-link': async (t) => {
        const name = t.dataset.name;
        if (!confirm(`Make a new setup link for ${name}? The phone ${name} uses now stops working straight away; they set it up again with the new link.`)) return;
        t.disabled = true;
        try { const link = await cloud.resetMember(t.dataset.id); toast('New link made — send it to ' + name); shareLink(link, name); }
        catch (e) { toast(e instanceof TypeError ? 'No internet connection' : e.message); }
        t.disabled = false;
      },
      'cloud-pass': () => modal('Change password', `${field('New password (at least 8 characters)', 'pw', '', { type: 'password', req: true })}`, (f) => {
        if (f.pw.length < 8) { toast('Use at least 8 characters'); return false; }
        cloud.setPassword(f.pw).then(() => toast('Password changed'), (e) => toast(e.message));
      }, 'Change password'),
    };
    const CHANGE = {
      'day-pick': (t) => { if (t.value) { ui.day = t.value; render(); } },
      'month-pick': (t) => { if (t.value) { ui.month = t.value; render(); } },
      ot: (t) => { C.setMark(data, ui.day, t.dataset.e, { ot: round2(num(t.value)) }); save(); },
      note: (t) => { C.setMark(data, ui.day, t.dataset.e, { note: t.value.trim() }); save(); },
      import: (t) => { importBackup(t.files[0]); t.value = ''; },
    };
    const onClick = (e) => {
      const t = e.target.closest('[data-a]');
      if (!t || !el.contains(t)) return;
      if (t.tagName === 'TR' && e.target.closest('button,a')) return;
      if (t.classList.contains('na-modal-back') && e.target !== t) return;
      const fn = ACT[t.dataset.a];
      if (t.tagName === 'A') e.preventDefault();
      if (fn) fn(t, e);
    };
    const onChange = (e) => { const t = e.target; if (t.dataset && CHANGE[t.dataset.aChange] && el.contains(t)) CHANGE[t.dataset.aChange](t); };
    const onKey = (e) => { if (e.key === 'Escape' && !el.querySelector('.na-modal.forced')) closeModal(); };
    const onDocKey = (e) => {
      if (!el.querySelector('.na-pin-pad') || e.ctrlKey || e.metaKey) return;
      if (/^[0-9]$/.test(e.key)) ACT['pin-key']({ dataset: { k: e.key } });
      else if (e.key === 'Backspace') ACT['pin-key']({ dataset: { k: '⌫' } });
    };
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    el.addEventListener('keydown', onKey);
    document.addEventListener('keydown', onDocKey);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('hashchange', handleJoin);

    render();
    forcePassword();
    handleJoin();

    /* what the host system can use */
    return {
      getData: () => data,
      setData: (d) => { data = C.normalise(d); save(); render(); },
      reload: () => { data = C.normalise(storage.load()); render(); },
      isBusy: () => !!el.querySelector('.na-modal-back') || (el.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)),
      show: (tab) => { ui.tab = tab; render(); },
      payFor: (empId, iso) => { const e = empById(empId); return e ? C.calcPeriod(data, e, C.periodFor(e, iso || C.localToday())) : null; },
      destroy: () => { el.removeEventListener('click', onClick); el.removeEventListener('change', onChange); el.removeEventListener('keydown', onKey); document.removeEventListener('keydown', onDocKey); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('hashchange', handleJoin); el.innerHTML = ''; el.classList.remove('nms-att'); },
    };
  }

  root.NMSAttendance = { mount, localStore, core: C };
})(typeof self !== 'undefined' ? self : this);
