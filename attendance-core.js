/* Nazeer's Motor Spares — attendance & pay engine.
   Pure logic, no screen code: works in a browser (window.NMSAttendanceCore) or Node (require).
   Another system can use this file on its own to read attendance or work out pay. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NMSAttendanceCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = 1;

  /* Attendance codes. `pay` is the share of a day's pay the day earns. */
  const STATUS = {
    P: { label: 'Present', short: 'P', pay: 1, worked: 1 },
    L: { label: 'Late', short: 'L', pay: 1, worked: 1 },
    H: { label: 'Half day', short: 'H', pay: 0.5, worked: 0.5 },
    A: { label: 'Absent', short: 'A', pay: 0, worked: 0 },
    S: { label: 'Sick (paid)', short: 'S', pay: 1, worked: 0 },
    V: { label: 'Leave (paid)', short: 'V', pay: 1, worked: 0 },
    O: { label: 'Day off', short: 'O', pay: 0, worked: 0 },
  };
  const STATUS_ORDER = ['P', 'L', 'H', 'A', 'S', 'V', 'O'];

  const SCHEDULES = { monthly: 'Monthly', fortnightly: 'Every two weeks', weekly: 'Weekly' };
  const PAY_TYPES = { salary: 'Fixed salary per pay period', daily: 'Daily rate (paid per day worked)' };
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* ---------- dates (ISO yyyy-mm-dd, worked out in UTC so daylight saving never shifts a day) ---------- */
  const toDate = (iso) => new Date(iso + 'T00:00:00Z');
  const toISO = (d) => d.toISOString().slice(0, 10);
  const addDays = (iso, n) => { const d = toDate(iso); d.setUTCDate(d.getUTCDate() + n); return toISO(d); };
  const dow = (iso) => toDate(iso).getUTCDay();
  const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000);
  const daysInMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); // m is 0-based
  function localToday() {
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function fmtDate(iso, withDay) {
    if (!iso) return '—';
    const d = toDate(iso);
    return (withDay ? DAY_NAMES[d.getUTCDay()].slice(0, 3) + ' ' : '') + `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }
  function eachDay(start, end, fn) { for (let d = start; d <= end; d = addDays(d, 1)) fn(d); }

  const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  /* ---------- data ---------- */
  function blankData() {
    return {
      app: 'nms-attendance', version: VERSION,
      settings: { business: "Nazeer's Motor Spares", currency: 'R', phone: '', since: '' }, // since: first day attendance was kept here
      employees: [],
      marks: {},    // { '2026-11-23': { employeeId: { s: 'P', ot: 0, note: '' } } }
      closed: {},   // { '2026-12-25': 'Christmas Day' } — the shop is closed, nobody is expected
      advances: [], // { id, empId, date, amount, note } — taken off the pay for the period the date falls in
      payments: [], // { id, empId, start, end, paidOn, method, net, slip } — a pay period marked as paid
    };
  }

  function blankEmployee() {
    return {
      id: '', name: '', phone: '', role: '', idNo: '', startDate: localToday(), endDate: '', active: true,
      payType: 'salary', rate: 0, schedule: 'monthly',
      payDay: 25,            // monthly: day of the month (31 = last day). weekly / fortnightly: 0 Sun … 6 Sat
      anchor: '',            // fortnightly: any one real pay date, so the two-week cycle lines up
      workDays: [1, 2, 3, 4, 5, 6],
      otRate: 0,             // paid per overtime hour
      lateDeduct: 0,         // taken off per late arrival (0 = only counted)
      notes: '',
    };
  }

  /* Fill in anything missing (older files, hand-edited data, data from another system). */
  function normalise(data) {
    const base = blankData();
    const d = data && typeof data === 'object' ? data : {};
    const out = {
      ...base, ...d,
      settings: { ...base.settings, ...(d.settings || {}) },
      employees: Array.isArray(d.employees) ? d.employees.map((e) => ({ ...blankEmployee(), ...e })) : [],
      marks: d.marks && typeof d.marks === 'object' ? d.marks : {},
      closed: d.closed && typeof d.closed === 'object' ? d.closed : {},
      advances: Array.isArray(d.advances) ? d.advances : [],
      payments: Array.isArray(d.payments) ? d.payments : [],
    };
    if (!out.settings.since) out.settings.since = localToday();
    out.version = VERSION;
    out.app = 'nms-attendance';
    return out;
  }

  /* ---------- marking ---------- */
  function getMark(data, date, empId) { return (data.marks[date] || {})[empId] || null; }
  function setMark(data, date, empId, patch) {
    const day = data.marks[date] || (data.marks[date] = {});
    const cur = day[empId] || { s: '', ot: 0, note: '' };
    const next = { ...cur, ...patch };
    if (!next.s && !num(next.ot) && !next.note) delete day[empId];
    else day[empId] = next;
    if (!Object.keys(day).length) delete data.marks[date];
  }
  const isWorkDay = (emp, iso) => (emp.workDays || []).includes(dow(iso));
  /* is this person expected at work on this date? */
  function expected(data, emp, iso) {
    if (data.closed[iso]) return false;
    if (emp.startDate && iso < emp.startDate) return false;
    if (emp.endDate && iso > emp.endDate) return false;
    return isWorkDay(emp, iso);
  }

  /* ---------- pay periods ---------- */
  /* The pay period (start … end, both inclusive) that contains `iso`. end is the pay day. */
  function periodFor(emp, iso) {
    if (emp.schedule === 'weekly' || emp.schedule === 'fortnightly') {
      const w = ((Math.round(num(emp.payDay)) % 7) + 7) % 7;
      if (emp.schedule === 'weekly') {
        const end = addDays(iso, (w - dow(iso) + 7) % 7);
        return { start: addDays(end, -6), end };
      }
      // fortnightly: line up with a known pay date, or the first pay weekday on/after the start date
      let anchor = emp.anchor;
      if (!anchor || dow(anchor) !== w) {
        const from = anchor || emp.startDate || '2026-01-01';
        anchor = addDays(from, (w - dow(from) + 7) % 7);
      }
      const k = Math.ceil(daysBetween(anchor, iso) / 14);
      const end = addDays(anchor, 14 * k);
      return { start: addDays(end, -13), end };
    }
    // monthly. Pay day 31 (or any day past the month's end) means the last day of the month.
    const pd = Math.min(31, Math.max(1, Math.round(num(emp.payDay) || 31)));
    const endIn = (y, m) => { const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12; return toISO(new Date(Date.UTC(yy, mm, Math.min(pd, daysInMonth(yy, mm))))); };
    const t = toDate(iso), y = t.getUTCFullYear(), m = t.getUTCMonth();
    const thisEnd = endIn(y, m);
    const end = iso <= thisEnd ? thisEnd : endIn(y, m + 1);
    const e = toDate(end);
    const start = addDays(endIn(e.getUTCFullYear(), e.getUTCMonth() - 1), 1);
    return { start, end };
  }
  /* step through periods: offset -1 is the one before the period containing iso */
  function periodAt(emp, iso, offset) {
    let p = periodFor(emp, iso);
    for (let i = 0; i < Math.abs(offset || 0); i++) p = periodFor(emp, offset < 0 ? addDays(p.start, -1) : addDays(p.end, 1));
    return p;
  }
  /* next pay day on or after `iso` */
  const nextPayDay = (emp, iso) => periodFor(emp, iso).end;

  /* ---------- pay calculation ---------- */
  function calcPeriod(data, emp, period, todayISO) {
    const now = todayISO || localToday();
    const { start, end } = period;
    const c = { P: 0, L: 0, H: 0, A: 0, S: 0, V: 0, O: 0, expected: 0, beforeStart: 0, extra: 0, unrecorded: 0, upcoming: 0, otHours: 0, closed: 0 };
    const unrecordedDates = [];
    eachDay(start, end, (d) => {
      const m = getMark(data, d, emp.id);
      if (m) c.otHours += num(m.ot);
      const scheduled = isWorkDay(emp, d) && !data.closed[d] && !(emp.endDate && d > emp.endDate);
      if (data.closed[d] && isWorkDay(emp, d)) c.closed++;
      if (scheduled && emp.startDate && d < emp.startDate) { c.beforeStart++; c.expected++; return; }
      if (scheduled) c.expected++;
      const s = m && m.s;
      if (!s) {
        // days before attendance was kept in this app are not flagged (and not deducted)
        if (scheduled) { if (d > now) c.upcoming++; else if (!data.settings.since || d >= data.settings.since) { c.unrecorded++; unrecordedDates.push(d); } }
        return;
      }
      if (!STATUS[s]) return;
      if (scheduled) c[s]++;
      // turned up on a day they are not normally expected (a day off, or the shop was closed)
      else if (STATUS[s].worked > 0) c.extra += STATUS[s].worked;
    });

    const rate = num(emp.rate);
    const lines = [];
    let dayRate, earned;
    if (emp.payType === 'daily') {
      dayRate = rate;
      // future scheduled days are left out until they have happened; unrecorded days are not paid
      const days = c.P + c.L + c.S + c.V + 0.5 * c.H;
      earned = round2(days * dayRate);
      lines.push({ label: `${trim(days)} day(s) × ${trim(dayRate)}`, amount: earned });
    } else {
      // fixed salary: the full amount, less unpaid days. A day is worth salary ÷ working days in the period.
      dayRate = c.expected ? rate / c.expected : 0;
      earned = rate;
      lines.push({ label: 'Salary for the period', amount: round2(rate) });
      const unpaid = c.A + 0.5 * c.H + c.beforeStart;
      if (c.A) lines.push({ label: `Absent ${trim(c.A)} day(s)`, amount: -round2(c.A * dayRate) });
      if (c.H) lines.push({ label: `Half days ${trim(c.H)} (½ day each)`, amount: -round2(0.5 * c.H * dayRate) });
      if (c.beforeStart) lines.push({ label: `${c.beforeStart} working day(s) before start date`, amount: -round2(c.beforeStart * dayRate) });
      earned = round2(rate - unpaid * dayRate);
    }
    if (c.extra) lines.push({ label: `Extra day(s) worked on days off: ${trim(c.extra)}`, amount: round2(c.extra * dayRate) });
    const overtime = round2(c.otHours * num(emp.otRate));
    if (overtime) lines.push({ label: `Overtime ${trim(c.otHours)} h × ${trim(num(emp.otRate))}`, amount: overtime });
    const latePen = round2(c.L * num(emp.lateDeduct));
    if (latePen) lines.push({ label: `Late ${c.L} time(s) × ${trim(num(emp.lateDeduct))}`, amount: -latePen });
    const adv = data.advances.filter((a) => a.empId === emp.id && a.date >= start && a.date <= end);
    const advTotal = round2(adv.reduce((a, x) => a + num(x.amount), 0));
    if (advTotal) lines.push({ label: `Advance(s) already paid (${adv.length})`, amount: -advTotal });

    const gross = round2(earned + c.extra * dayRate + overtime);
    const net = round2(gross - latePen - advTotal);
    const payment = data.payments.find((p) => p.empId === emp.id && p.start === start && p.end === end) || null;
    return {
      start, end, counts: c, dayRate: round2(dayRate), gross, overtime, latePen, advances: adv, advTotal, net, lines,
      unrecordedDates, complete: end <= now && !c.unrecorded, payment,
      daysToPay: daysBetween(now, end),
    };
  }
  const trim = (n) => String(round2(n)).replace(/\.0+$/, '');

  /* ---------- summaries ---------- */
  function daySummary(data, iso) {
    const out = { date: iso, closed: data.closed[iso] || '', rows: [], counts: {}, missing: 0 };
    for (const k of STATUS_ORDER) out.counts[k] = 0;
    for (const e of data.employees.filter((x) => x.active !== false)) {
      const m = getMark(data, iso, e.id);
      const exp = expected(data, e, iso);
      if (m && m.s) out.counts[m.s]++;
      else if (exp) out.missing++;
      if (exp || (m && m.s)) out.rows.push({ emp: e, mark: m, expected: exp });
    }
    return out;
  }

  /* Plain text for WhatsApp */
  const ICONS = { P: '✅', L: '⏰', H: '🌓', A: '❌', S: '🤒', V: '🏖️', O: '➖' };
  function dayText(data, iso) {
    const s = daySummary(data, iso);
    const head = `*${data.settings.business}* — attendance\n${fmtDate(iso, true)}`;
    if (s.closed) return `${head}\nShop closed: ${s.closed}`;
    const lines = s.rows.map(({ emp, mark }) => {
      const st = mark && mark.s ? STATUS[mark.s] : null;
      const extra = [mark && num(mark.ot) ? `+${trim(num(mark.ot))}h overtime` : '', mark && mark.note].filter(Boolean).join(', ');
      return `${st ? ICONS[mark.s] : '❔'} ${emp.name} — ${st ? st.label : 'not marked'}${extra ? ` (${extra})` : ''}`;
    });
    const tally = STATUS_ORDER.filter((k) => s.counts[k]).map((k) => `${STATUS[k].label} ${s.counts[k]}`).join(' · ');
    return `${head}\n\n${lines.join('\n')}\n\n${tally}`;
  }
  function payText(data, emp, r, money) {
    const c = r.counts;
    return [
      `*${data.settings.business}* — pay slip`,
      `${emp.name}${emp.role ? ` (${emp.role})` : ''}`,
      `Period: ${fmtDate(r.start)} – ${fmtDate(r.end)}`,
      '',
      `Days present ${c.P + c.L}${c.L ? ` (late ${c.L})` : ''} · half days ${c.H} · absent ${c.A} · sick ${c.S} · leave ${c.V}`,
      '',
      ...r.lines.map((l) => `${l.label}: ${money(l.amount)}`),
      '',
      `*To pay: ${money(r.net)}*`,
      r.payment ? `Paid on ${fmtDate(r.payment.paidOn)} (${r.payment.method})` : '',
    ].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n').trim();
  }

  return {
    VERSION, STATUS, STATUS_ORDER, SCHEDULES, PAY_TYPES, DAY_NAMES, MONTHS,
    blankData, blankEmployee, normalise, uid, num, round2,
    toISO, addDays, dow, daysBetween, daysInMonth, localToday, fmtDate, eachDay,
    getMark, setMark, isWorkDay, expected,
    periodFor, periodAt, nextPayDay, calcPeriod, daySummary, dayText, payText,
  };
});
