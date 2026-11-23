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
    function cloudCard() {
      const s = cloud.status();
      if (!s.signedIn) return `<section class="na-card na-pad" id="na-cloud"><h3 class="na-h3">Share between phones</h3>
        <p class="na-hint">Sign in with the username and password you were given. Use your own login on your own phone — Nazeer and the manager then see the same register and pay, and changes arrive on the other phone within about a minute. Without signal the app keeps working and catches up later.</p>
        <div class="na-form g2"><label class="na-fld"><span>Username</span><input id="na-email" type="text" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="e.g. nazeer"></label>
        <label class="na-fld"><span>Password</span><input id="na-pass" type="password" autocomplete="current-password"></label></div>
        <div class="na-actions" style="margin-top:12px"><button type="button" class="na-btn primary" data-a="cloud-in">Sign in</button></div></section>`;
      return `<section class="na-card na-pad" id="na-cloud"><h3 class="na-h3">Share between phones</h3>
        <p class="na-sync"><span class="na-dot ${s.ok ? 'ok' : 'bad'}"></span>${esc(s.text)}</p>
        <p class="na-hint">Signed in as <b>${esc(s.login || s.email)}</b>${s.role ? ` (${esc(s.role)})` : ''}. Every change is shared with the other phones.</p>
        <div class="na-actions"><button type="button" class="na-btn" data-a="cloud-sync">Sync now</button><button type="button" class="na-btn" data-a="cloud-pass">Change password</button><button type="button" class="na-btn ghost" data-a="cloud-out">Sign out</button></div></section>`;
    }
    /* with requireSignIn, nothing but the sign-in screen shows until a member signs in */
    const gated = () => !!(cloud && opts.requireSignIn && !cloud.status().signedIn);
    let wasGated = gated();
    function gateScreen() {
      el.innerHTML = `<div class="na-gate"><form class="na-gate-box" data-form="login" autocomplete="on">
        <div class="na-gate-mark">NMS</div>
        <h1>${esc(data.settings.business || "Nazeer's Motor Spares")}</h1>
        <p>Staff attendance &amp; pay — sign in to continue.</p>
        <label class="na-fld"><span>Username</span><input id="na-email" name="username" type="text" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="e.g. nazeer" required></label>
        <label class="na-fld"><span>Password</span><input id="na-pass" name="password" type="password" autocomplete="current-password" required></label>
        <button class="na-btn primary na-gate-go">Sign in</button>
        <p class="na-gate-small">For the owner and manager only. Forgotten your password? Ask the administrator for a new temporary one.</p>
      </form></div>`;
      const f = el.querySelector('[data-form="login"]');
      f.addEventListener('submit', (e) => { e.preventDefault(); ACT['cloud-in'](f.querySelector('.na-gate-go')); });
      const u = f.querySelector('#na-email'); if (u && matchMedia('(hover: hover)').matches) u.focus();
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
    const TABS = [['today', 'Daily register', 'Today'], ['month', 'Month sheet', 'Month'], ['pay', 'Pay', 'Pay'], ['staff', 'Staff', 'Staff'], ['settings', 'Settings', 'Settings']];
    function render() {
      wasGated = gated();
      if (wasGated) { closeModal(); gateScreen(); return; }
      el.innerHTML = `
        <header class="na-top">
          <div class="na-brand"><b>${esc(data.settings.business)}</b><i>${cloudLine()}</i></div>
          <nav class="na-tabs">${TABS.map(([k, l, sh]) => `<button type="button" data-a="tab" data-k="${k}" class="${ui.tab === k ? 'on' : ''}"><span class="na-long">${l}</span><span class="na-short">${sh}</span></button>`).join('')}</nav>
        </header>
        <main class="na-main"></main>`;
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
    function viewToday(main) {
      const d = ui.day, isToday = d === C.localToday();
      const sum = C.daySummary(data, d);
      const closed = data.closed[d];
      const staff = activeStaff();
      main.innerHTML = `
        <div class="na-head">
          <div class="na-daynav">
            <button type="button" class="na-btn sm" data-a="day" data-n="-1" aria-label="Previous day">‹</button>
            <input type="date" class="na-date" value="${d}" data-a-change="day-pick">
            <button type="button" class="na-btn sm" data-a="day" data-n="1" aria-label="Next day">›</button>
            ${isToday ? '<span class="na-chip">Today</span>' : '<button type="button" class="na-btn sm ghost" data-a="day-today">Back to today</button>'}
          </div>
          <div class="na-actions">
            ${closed ? '' : `<button type="button" class="na-btn" data-a="all-present" ${sum.missing ? '' : 'disabled'}>Mark the rest present</button>`}
            <button type="button" class="na-btn" data-a="closed">${closed ? 'Shop is open after all' : 'Shop closed'}</button>
            <button type="button" class="na-btn wa" data-a="share-day">Send on WhatsApp</button>
          </div>
        </div>
        ${cloud && !cloud.status().signedIn ? '<div class="na-warn">Not signed in — these records are only on this phone. <a href="#" data-a="tab" data-k="settings">Sign in</a> so Nazeer and the manager see the same register.</div>' : ''}
        <h1 class="na-h1">${fmtDate(d, true)}</h1>
        ${closed ? `<div class="na-card na-pad na-closed"><b>Shop closed — ${esc(closed)}</b><p>Nobody is expected today. Salaries are not reduced; daily-rate staff are not paid for the day. Anyone who still came in can be marked below and is paid an extra day.</p></div>` : ''}
        ${!closed ? `<div class="na-tally">${STATUS_ORDER.filter((k) => sum.counts[k]).map((k) => `<span class="na-s s-${k}">${STATUS[k].label} <b>${sum.counts[k]}</b></span>`).join('')}${sum.missing ? `<span class="na-s s-none">Not marked <b>${sum.missing}</b></span>` : staff.length ? '<span class="na-s s-done">Everyone marked</span>' : ''}</div>` : ''}
        <section class="na-card">
          ${staff.length ? staff.map((e) => {
            const m = C.getMark(data, d, e.id) || {};
            const exp = C.expected(data, e, d);
            return `<div class="na-row ${!exp && !m.s ? 'na-off' : ''}">
              <div class="na-who"><b>${esc(e.name)}</b><i>${esc(e.role || '')}${exp ? '' : `${e.role ? ' · ' : ''}${closed ? 'shop closed' : e.startDate > d ? 'not started yet' : 'not a working day'}`}</i></div>
              <div class="na-seg" role="group" aria-label="Attendance for ${esc(e.name)}">
                ${STATUS_ORDER.map((k) => `<button type="button" class="s-${k} ${m.s === k ? 'on' : ''}" data-a="mark" data-e="${e.id}" data-s="${k}" title="${STATUS[k].label}" aria-pressed="${m.s === k}">${STATUS[k].label.replace(' (paid)', '')}</button>`).join('')}
              </div>
              <div class="na-extra">
                <label title="Overtime hours"><span>OT h</span><input type="number" min="0" step="0.5" inputmode="decimal" value="${num(m.ot) || ''}" data-a-change="ot" data-e="${e.id}" placeholder="0"></label>
                <input type="text" class="na-note" value="${esc(m.note || '')}" data-a-change="note" data-e="${e.id}" placeholder="Note (optional)">
              </div>
            </div>`;
          }).join('') : '<div class="na-empty"><b>No staff yet.</b><p>Add your employees under Staff first.</p></div>'}
        </section>
        <p class="na-hint">Tap a status to mark it, tap it again to clear. Changes save straight away.</p>`;
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
    function viewPay(main) {
      const staff = activeStaff();
      const now = C.localToday();
      const off = ui.payOffset;
      const results = staff.map((e) => ({ e, r: C.calcPeriod(data, e, C.periodAt(e, now, off), now) }));
      const total = results.reduce((a, x) => a + x.r.net, 0);
      const unpaid = results.filter((x) => !x.r.payment);
      main.innerHTML = `
        <div class="na-head">
          <div class="na-daynav">
            <button type="button" class="na-btn sm" data-a="pay-off" data-n="-1" aria-label="Earlier pay periods">‹</button>
            <span class="na-chip">${off === 0 ? 'Current pay period' : off === -1 ? 'Last pay period' : off < 0 ? `${-off} periods ago` : `${off} period(s) ahead`}</span>
            <button type="button" class="na-btn sm" data-a="pay-off" data-n="1" aria-label="Later pay periods">›</button>
            ${off ? '<button type="button" class="na-btn sm ghost" data-a="pay-now">Back to current</button>' : ''}
          </div>
        </div>
        <h1 class="na-h1">Pay</h1>
        <div class="na-stats">
          <div class="na-stat hero"><span>${off === 0 ? 'Owed so far this period' : 'Total for these periods'}</span><b>${money(total)}</b><i>${results.length} employee(s) · ${unpaid.length} not paid yet</i></div>
          ${results.slice().filter((x) => !x.r.payment).sort((a, b) => a.r.end.localeCompare(b.r.end)).slice(0, 3).map(({ e, r }) => `<div class="na-stat"><span>${esc(e.name)}</span><b>${money(r.net)}</b><i>${r.daysToPay > 1 ? `Pay day in ${r.daysToPay} days — ${fmtDate(r.end, true)}` : r.daysToPay === 1 ? 'Pay day is tomorrow' : r.daysToPay === 0 ? 'Pay day is today' : `Was due ${fmtDate(r.end)}`}</i></div>`).join('')}
        </div>
        ${results.length ? results.map(({ e, r }) => payCard(e, r)).join('') : '<section class="na-card"><div class="na-empty"><b>No staff yet.</b><p>Add employees under Staff.</p></div></section>'}
        <p class="na-hint">Fixed salary: the full salary, less absent days and half days (one day = salary ÷ working days in the period). Days nobody marked are not deducted until you mark them. Daily rate: only days marked Present, Late, Sick or Leave are paid (half days pay half). Advances given during the period come off the pay.</p>`;
    }
    function payCard(e, r) {
      const c = r.counts;
      const status = r.payment ? `<span class="na-pill ok">Paid ${fmtDate(r.payment.paidOn)}</span>`
        : r.daysToPay < 0 ? '<span class="na-pill bad">Pay day passed</span>'
        : r.daysToPay <= 2 ? `<span class="na-pill warn">Pay day ${r.daysToPay === 0 ? 'today' : r.daysToPay === 1 ? 'tomorrow' : 'in 2 days'}</span>`
        : `<span class="na-pill">Pay day ${fmtDate(r.end)}</span>`;
      return `<section class="na-card na-pay">
        <div class="na-pay-head">
          <div><b>${esc(e.name)}</b><i>${esc(e.role ? e.role + ' · ' : '')}${C.SCHEDULES[e.schedule]} · ${e.payType === 'daily' ? `${money(num(e.rate))} a day` : `${money(num(e.rate))} a period`}</i></div>
          ${status}
        </div>
        <div class="na-pay-body">
          <div>
            <div class="na-period">${fmtDate(r.start)} – ${fmtDate(r.end)}</div>
            <div class="na-counts">
              <span class="s-P">Present <b>${c.P + c.L}</b></span>${c.L ? `<span class="s-L">Late <b>${c.L}</b></span>` : ''}<span class="s-H">Half <b>${c.H}</b></span><span class="s-A">Absent <b>${c.A}</b></span>${c.S ? `<span class="s-S">Sick <b>${c.S}</b></span>` : ''}${c.V ? `<span class="s-V">Leave <b>${c.V}</b></span>` : ''}${c.extra ? `<span>Extra days <b>${c.extra}</b></span>` : ''}${c.otHours ? `<span>Overtime <b>${round2(c.otHours)} h</b></span>` : ''}
            </div>
            ${c.unrecorded ? `<p class="na-warn">${c.unrecorded} working day(s) not marked yet: ${r.unrecordedDates.slice(0, 6).map((d) => `<a href="#" data-a="goto-day" data-d="${d}">${fmtDate(d, true)}</a>`).join(', ')}${r.unrecordedDates.length > 6 ? '…' : ''}</p>` : ''}
            ${c.upcoming && !r.payment ? `<p class="na-hint">${c.upcoming} working day(s) still to come — the amount is ${e.payType === 'daily' ? 'so far' : 'if nobody is absent'}.</p>` : ''}
          </div>
          <table class="na-lines">${r.lines.map((l) => `<tr><td>${esc(l.label)}</td><td class="${l.amount < 0 ? 'neg' : ''}">${money(l.amount)}</td></tr>`).join('')}
            <tr class="tot"><td>${r.payment ? 'Paid' : 'To pay'}</td><td>${money(r.payment ? r.payment.net : r.net)}</td></tr></table>
        </div>
        <div class="na-pay-foot">
          <button type="button" class="na-btn sm" data-a="advance" data-e="${e.id}">Give advance</button>
          <button type="button" class="na-btn sm" data-a="slip" data-e="${e.id}" data-s="${r.start}">Print pay slip</button>
          <button type="button" class="na-btn sm wa" data-a="share-slip" data-e="${e.id}" data-s="${r.start}">WhatsApp pay slip</button>
          ${r.payment ? `<button type="button" class="na-btn sm ghost" data-a="unpay" data-p="${r.payment.id}">Undo paid</button>` : `<button type="button" class="na-btn sm primary" data-a="pay" data-e="${e.id}" data-s="${r.start}">Mark as paid</button>`}
        </div>
      </section>`;
    }
    function resultFor(empId, start) {
      const e = empById(empId);
      return { e, r: C.calcPeriod(data, e, C.periodFor(e, start), C.localToday()) };
    }
    function payModal(empId, start) {
      const { e, r } = resultFor(empId, start);
      const warn = r.counts.unrecorded ? `<p class="na-warn">${r.counts.unrecorded} working day(s) in this period are not marked yet.</p>` : '';
      modal(`Pay ${e.name}`, `${warn}
        <p>${fmtDate(r.start)} – ${fmtDate(r.end)}. Worked out: <b>${money(r.net)}</b></p>
        <div class="na-form g2">
          ${field('Amount paid', 'net', round2(r.net), { type: 'number', req: true })}
          ${field('Date paid', 'paidOn', C.localToday(), { type: 'date' })}
          ${field('How', 'method', 'Cash', { options: [['Cash', 'Cash'], ['Bank transfer', 'Bank transfer'], ['EFT', 'EFT'], ['Other', 'Other']] })}
          ${field('Note (optional)', 'note', '')}
        </div>`, (f) => {
        data.payments.push({ id: C.uid(), empId: e.id, start: r.start, end: r.end, paidOn: f.paidOn || C.localToday(), method: f.method, note: f.note, net: round2(num(f.net)), calculated: r.net, slip: { lines: r.lines, counts: r.counts } });
        save(); toast(`${e.name} marked as paid`); render();
      }, 'Mark as paid');
    }
    function advanceModal(empId) {
      const e = empById(empId);
      const list = data.advances.filter((a) => a.empId === empId).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
      modal(`Advance for ${e.name}`, `
        <div class="na-form g2">
          ${field('Amount', 'amount', '', { type: 'number', req: true })}
          ${field('Date given', 'date', C.localToday(), { type: 'date' })}
          ${field('Note (optional)', 'note', '', { cls: 'span2' })}
        </div>
        <p class="na-hint">It is taken off the pay for the period the date falls in.</p>
        ${list.length ? `<h3 class="na-h3">Recent advances</h3><table class="na-lines">${list.map((a) => `<tr><td>${fmtDate(a.date)}${a.note ? ' — ' + esc(a.note) : ''}</td><td>${money(num(a.amount))}</td><td><button type="button" class="na-x sm" data-a="del-adv" data-id="${a.id}" aria-label="Remove advance">×</button></td></tr>`).join('')}</table>` : ''}`,
      (f) => {
        if (num(f.amount) <= 0) { toast('Enter an amount'); return false; }
        data.advances.push({ id: C.uid(), empId, date: f.date || C.localToday(), amount: round2(num(f.amount)), note: f.note });
        save(); toast('Advance recorded'); render();
      }, 'Record advance');
    }

    /* pay slip, printed on its own page */
    function printSlip(empId, start) {
      const { e, r } = resultFor(empId, start);
      const c = r.counts, s = data.settings;
      const net = r.payment ? r.payment.net : r.net;
      printHTML(`<div class="nap-slip">
        <header><div><h1>${esc(s.business)}</h1>${s.phone ? `<p>${esc(s.phone)}</p>` : ''}</div><div class="r"><h2>Pay slip</h2><p>${fmtDate(r.start)} – ${fmtDate(r.end)}</p></div></header>
        <table class="kv"><tr><th>Employee</th><td>${esc(e.name)}</td><th>Role</th><td>${esc(e.role || '—')}</td></tr>
          <tr><th>ID no</th><td>${esc(e.idNo || '—')}</td><th>Paid</th><td>${C.SCHEDULES[e.schedule]}</td></tr></table>
        <h3>Attendance</h3>
        <table class="kv"><tr><th>Working days</th><td>${c.expected}</td><th>Present</th><td>${c.P + c.L}${c.L ? ` (late ${c.L})` : ''}</td></tr>
          <tr><th>Half days</th><td>${c.H}</td><th>Absent</th><td>${c.A}</td></tr>
          <tr><th>Sick / leave</th><td>${c.S} / ${c.V}</td><th>Overtime</th><td>${round2(c.otHours)} h</td></tr></table>
        <h3>Pay</h3>
        <table class="lines">${r.lines.map((l) => `<tr><td>${esc(l.label)}</td><td>${money(l.amount)}</td></tr>`).join('')}
          ${r.payment && Math.abs(r.payment.net - r.net) > 0.004 ? `<tr><td>Adjusted when paid${r.payment.note ? ' — ' + esc(r.payment.note) : ''}</td><td>${money(r.payment.net - r.net)}</td></tr>` : ''}
          <tr class="tot"><td>${r.payment ? `Paid ${fmtDate(r.payment.paidOn)} · ${esc(r.payment.method)}` : 'Amount to pay'}</td><td>${money(net)}</td></tr></table>
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
            <td class="r"><button type="button" class="na-btn sm" data-a="advance" data-e="${e.id}">Advance</button></td></tr>`).join('')}
          </tbody></table>` : `<div class="na-empty"><b>Add your staff to start.</b><p>For each person: their name, how much they earn, and when they are paid (monthly, every two weeks or weekly). Then mark attendance each day instead of sending it on WhatsApp — pay works itself out.</p><button type="button" class="na-btn primary" data-a="emp">+ Add employee</button></div>`}</section>`;
    }
    function payDayText(e) {
      if (e.schedule === 'monthly') return num(e.payDay) >= 31 ? 'on the last day of the month' : `on the ${ordinal(num(e.payDay))}`;
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
          ${field('Start date', 'startDate', e.startDate, { type: 'date' })}
          ${field('Paid', 'schedule', e.schedule, { options: Object.entries(C.SCHEDULES) })}
          ${field('How pay is worked out', 'payType', e.payType, { options: Object.entries(C.PAY_TYPES), cls: 'span2' })}
          ${field(e.payType === 'daily' ? 'Rate per day' : 'Salary per pay period', 'rate', num(e.rate) || '', { type: 'number', req: true, hint: 'Monthly → the monthly salary. Weekly → the weekly wage. Daily rate → the amount for one day.' })}
          <label class="na-fld" data-pd="monthly" ${e.schedule === 'monthly' ? '' : 'hidden'}><span>Pay day</span><select name="payDayM">${monthDays.map(([v, l]) => `<option value="${v}" ${e.schedule === 'monthly' && +e.payDay === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="na-fld" data-pd="week" ${e.schedule === 'monthly' ? 'hidden' : ''}><span>Pay day</span><select name="payDayW">${days.map(([v, l]) => `<option value="${v}" ${e.schedule !== 'monthly' && +e.payDay === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="na-fld span2" data-pd="fortnightly" ${e.schedule === 'fortnightly' ? '' : 'hidden'}><span>One recent or upcoming pay date</span><input type="date" name="anchor" value="${esc(e.anchor)}"><i>So the app knows which week the two-week cycle ends on.</i></label>
          <div class="na-fld span2"><span>Normal working days</span><div class="na-days">${days.map(([v, l]) => `<label><input type="checkbox" name="workDays" value="${v}" ${(e.workDays || []).includes(v) ? 'checked' : ''}>${l.slice(0, 3)}</label>`).join('')}</div></div>
          ${field('Overtime pay per hour', 'otRate', num(e.otRate) || '', { type: 'number', ph: '0' })}
          ${field('Deduct per late arrival', 'lateDeduct', num(e.lateDeduct) || '', { type: 'number', ph: '0 = just count it' })}
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
        form.querySelector('[data-pd="week"]').hidden = sch === 'monthly';
        form.querySelector('[data-pd="fortnightly"]').hidden = sch !== 'fortnightly';
        form.rate.closest('.na-fld').firstElementChild.textContent = form.payType.value === 'daily' ? 'Rate per day' : sch === 'monthly' ? 'Salary per month' : sch === 'weekly' ? 'Wage per week' : 'Pay per two weeks';
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
      'pay-off': (t) => { ui.payOffset += +t.dataset.n; render(); },
      'pay-now': () => { ui.payOffset = 0; render(); },
      pay: (t) => payModal(t.dataset.e, t.dataset.s),
      unpay: (t) => {
        if (!confirm('Undo this payment? The period shows as not paid again.')) return;
        data.payments = data.payments.filter((p) => p.id !== t.dataset.p); save(); render();
      },
      slip: (t) => printSlip(t.dataset.e, t.dataset.s),
      'share-slip': (t) => { const { e, r } = resultFor(t.dataset.e, t.dataset.s); const txt = C.payText(data, e, r, money); share(txt); },
      advance: (t) => advanceModal(t.dataset.e),
      'del-adv': (t) => {
        if (!confirm('Remove this advance?')) return;
        const a = data.advances.find((x) => x.id === t.dataset.id);
        data.advances = data.advances.filter((x) => x.id !== t.dataset.id); save(); render(); advanceModal(a.empId);
      },
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
          if (!confirm(n ? `${n} change(s) on this phone have not reached the cloud yet — probably no signal. If you sign out now they are lost. Sign out anyway?`
            : 'Sign out on this phone? The shop\'s records are removed from this phone but stay safe in the cloud. Sign in again to get them back.')) return;
          cloud.signOut(); cloud.clearLocal(); data = C.normalise(null); ui.tab = 'today'; render();
          return;
        }
        if (!confirm('Sign out on this phone? The records stay on this phone and in the cloud.')) return;
        cloud.signOut(); render();
      },
      'cloud-sync': () => { cloud.run(); toast('Syncing…'); },
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
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    el.addEventListener('keydown', onKey);

    render();
    forcePassword();

    /* what the host system can use */
    return {
      getData: () => data,
      setData: (d) => { data = C.normalise(d); save(); render(); },
      reload: () => { data = C.normalise(storage.load()); render(); },
      isBusy: () => !!el.querySelector('.na-modal-back') || (el.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)),
      show: (tab) => { ui.tab = tab; render(); },
      payFor: (empId, iso) => { const e = empById(empId); return e ? C.calcPeriod(data, e, C.periodFor(e, iso || C.localToday())) : null; },
      destroy: () => { el.removeEventListener('click', onClick); el.removeEventListener('change', onChange); el.removeEventListener('keydown', onKey); el.innerHTML = ''; el.classList.remove('nms-att'); },
    };
  }

  root.NMSAttendance = { mount, localStore, core: C };
})(typeof self !== 'undefined' ? self : this);
