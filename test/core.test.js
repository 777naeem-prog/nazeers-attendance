'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../attendance-core.js');

const emp = (o) => ({ ...C.blankEmployee(), id: 'e1', name: 'Ahmed', startDate: '2026-01-01', ...o });

test('monthly period ends on the pay day', () => {
  const e = emp({ schedule: 'monthly', payDay: 25 });
  assert.deepEqual(C.periodFor(e, '2026-11-23'), { start: '2026-10-26', end: '2026-11-25' });
  assert.deepEqual(C.periodFor(e, '2026-11-26'), { start: '2026-11-26', end: '2026-12-25' });
  assert.deepEqual(C.periodFor(e, '2026-11-25'), { start: '2026-10-26', end: '2026-11-25' });
});

test('monthly pay day 31 means month end, also in February', () => {
  const e = emp({ schedule: 'monthly', payDay: 31 });
  assert.deepEqual(C.periodFor(e, '2026-02-10'), { start: '2026-02-01', end: '2026-02-28' });
  assert.deepEqual(C.periodFor(e, '2026-03-01'), { start: '2026-03-01', end: '2026-03-31' });
  assert.deepEqual(C.periodAt(e, '2026-03-15', -1), { start: '2026-02-01', end: '2026-02-28' });
});

test('weekly period ends on the pay weekday', () => {
  const e = emp({ schedule: 'weekly', payDay: 5 }); // Friday
  // 2026-11-23 is a Monday
  assert.deepEqual(C.periodFor(e, '2026-11-23'), { start: '2026-11-21', end: '2026-11-27' });
  assert.deepEqual(C.periodFor(e, '2026-11-27'), { start: '2026-11-21', end: '2026-11-27' });
  assert.deepEqual(C.periodAt(e, '2026-11-23', 1), { start: '2026-11-28', end: '2026-12-04' });
});

test('fortnightly lines up with the anchor pay date', () => {
  const e = emp({ schedule: 'fortnightly', payDay: 5, anchor: '2026-11-13' });
  assert.deepEqual(C.periodFor(e, '2026-11-23'), { start: '2026-11-14', end: '2026-11-27' });
  assert.deepEqual(C.periodFor(e, '2026-11-13'), { start: '2026-10-31', end: '2026-11-13' });
  assert.deepEqual(C.periodFor(e, '2026-11-01'), { start: '2026-10-31', end: '2026-11-13' });
});

test('fixed salary: absences and half days come off at salary / working days', () => {
  const d = C.blankData();
  const e = emp({ schedule: 'weekly', payDay: 6, rate: 3000, workDays: [1, 2, 3, 4, 5, 6] }); // Mon–Sat, paid Saturday
  d.employees.push(e);
  const p = C.periodFor(e, '2026-11-23'); // Sun 22 – Sat 28
  assert.deepEqual(p, { start: '2026-11-22', end: '2026-11-28' });
  ['2026-11-23', '2026-11-24', '2026-11-25'].forEach((x) => C.setMark(d, x, 'e1', { s: 'P' }));
  C.setMark(d, '2026-11-26', 'e1', { s: 'A' });
  C.setMark(d, '2026-11-27', 'e1', { s: 'H', ot: 2 });
  C.setMark(d, '2026-11-28', 'e1', { s: 'L' });
  e.otRate = 50; e.lateDeduct = 20;
  d.advances.push({ id: 'a', empId: 'e1', date: '2026-11-24', amount: 200 });
  const r = C.calcPeriod(d, e, p, '2026-11-28');
  assert.equal(r.dayRate, 500);
  assert.equal(r.counts.expected, 6);
  // 3000 − 500 (absent) − 250 (half) + 100 OT = 2350 gross; − 20 late − 200 advance = 2130
  assert.equal(r.gross, 2350);
  assert.equal(r.net, 2130);
  assert.equal(r.complete, true);
});

test('daily rate pays only recorded paid days; extra days on a day off are paid', () => {
  const d = C.blankData();
  d.settings.autoPresent = false; // this test is about marking every day by hand
  const e = emp({ payType: 'daily', schedule: 'weekly', payDay: 5, rate: 300, workDays: [1, 2, 3, 4, 5] });
  d.employees.push(e);
  const p = C.periodFor(e, '2026-11-23'); // Sat 21 – Fri 27
  C.setMark(d, '2026-11-21', 'e1', { s: 'P' }); // Saturday, not a work day → extra
  C.setMark(d, '2026-11-23', 'e1', { s: 'P' });
  C.setMark(d, '2026-11-24', 'e1', { s: 'S' });
  C.setMark(d, '2026-11-25', 'e1', { s: 'H' });
  const r = C.calcPeriod(d, e, p, '2026-11-26');
  // P + S + ½H = 2.5 × 300 = 750, + 1 extra day 300
  assert.equal(r.gross, 1050);
  assert.equal(r.counts.unrecorded, 1); // Thu 26
  assert.equal(r.counts.upcoming, 1);   // Fri 27
  assert.equal(r.complete, false);
});

test('a closed shop day is not counted as absent, and salary is not reduced', () => {
  const d = C.blankData();
  const e = emp({ schedule: 'weekly', payDay: 6, rate: 3000 });
  d.employees.push(e);
  d.closed['2026-11-24'] = 'Public holiday';
  const p = C.periodFor(e, '2026-11-23');
  for (const x of ['2026-11-23', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28']) C.setMark(d, x, 'e1', { s: 'P' });
  const r = C.calcPeriod(d, e, p, '2026-11-28');
  assert.equal(r.counts.expected, 5);
  assert.equal(r.net, 3000);
});

test('starting mid-period: salary is reduced for working days before the start date', () => {
  const d = C.blankData();
  const e = emp({ schedule: 'weekly', payDay: 6, rate: 3000, startDate: '2026-11-25' });
  d.employees.push(e);
  const p = C.periodFor(e, '2026-11-25');
  for (const x of ['2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28']) C.setMark(d, x, 'e1', { s: 'P' });
  const r = C.calcPeriod(d, e, p, '2026-11-28');
  assert.equal(r.net, 2000);
});

test('setMark removes empty marks; WhatsApp text lists everyone', () => {
  const d = C.blankData();
  d.employees.push(emp({}), emp({ id: 'e2', name: 'Bilal' }));
  C.setMark(d, '2026-11-23', 'e1', { s: 'P' });
  C.setMark(d, '2026-11-23', 'e2', { s: 'L', note: 'taxi' });
  const t = C.dayText(d, '2026-11-23');
  assert.match(t, /Ahmed — Present/);
  assert.match(t, /Bilal — Late \(taxi\)/);
  C.setMark(d, '2026-11-23', 'e1', { s: '' });
  C.setMark(d, '2026-11-23', 'e2', { s: '', note: '' });
  assert.deepEqual(d.marks, {});
});

test('normalise fills missing fields', () => {
  const d = C.normalise({ employees: [{ id: 'x', name: 'Y' }] });
  assert.equal(d.employees[0].schedule, 'monthly');
  assert.deepEqual(d.advances, []);
});

test('set dates each month: 10th, 20th and 30th (30th falls back to the end of February)', () => {
  const e = emp({ schedule: 'monthdays', payDays: [10, 20, 30] });
  assert.deepEqual(C.periodFor(e, '2026-11-05'), { start: '2026-10-31', end: '2026-11-10' });
  assert.deepEqual(C.periodFor(e, '2026-11-10'), { start: '2026-10-31', end: '2026-11-10' });
  assert.deepEqual(C.periodFor(e, '2026-11-11'), { start: '2026-11-11', end: '2026-11-20' });
  assert.deepEqual(C.periodFor(e, '2026-11-25'), { start: '2026-11-21', end: '2026-11-30' });
  assert.deepEqual(C.periodFor(e, '2026-12-31'), { start: '2026-12-31', end: '2027-01-10' });
  assert.deepEqual(C.periodFor(e, '2027-02-25'), { start: '2027-02-21', end: '2027-02-28' });
  assert.deepEqual(C.periodFor(e, '2027-03-01'), { start: '2027-03-01', end: '2027-03-10' });
  assert.deepEqual(C.periodFor({ ...e, payDays: '10, 20, 30' }, '2026-11-12'), { start: '2026-11-11', end: '2026-11-20' });
});

test('set dates each month: the monthly salary is split over the pay dates', () => {
  const d = C.blankData();
  const e = emp({ schedule: 'monthdays', payDays: [10, 20, 30], rate: 9000 });
  d.employees.push(e);
  const r = C.calcPeriod(d, e, C.periodFor(e, '2026-11-15'), '2026-11-20');
  assert.equal(r.gross, 3000);
});

test('running account: pay any amount, any day; what is left is still owed', () => {
  const d = C.blankData();
  d.settings.since = '2026-11-01';
  const e = emp({ schedule: 'monthdays', payDays: [10, 20, 30], rate: 9000 });
  d.employees.push(e);
  // nothing marked: salary is not reduced. Pay days 10 Nov and 20 Nov have passed by the 23rd.
  d.payments.push({ id: 'p1', empId: 'e1', paidOn: '2026-11-10', net: 3000, method: 'Cash' });
  d.payments.push({ id: 'p2', empId: 'e1', paidOn: '2026-11-15', net: 500, method: 'Cash' });   // random mid-month payment
  d.advances.push({ id: 'a1', empId: 'e1', date: '2026-11-18', amount: 200 });                   // old-style advance counts too
  let a = C.account(d, e, '2026-11-23');
  assert.equal(a.earned, 6000);   // 10 Nov + 20 Nov periods (the first covers 31 Oct – 10 Nov)
  assert.equal(a.paid, 3700);
  assert.equal(a.owed, 2300);
  assert.equal(a.current.end, '2026-11-30');
  assert.equal(a.nextPay, 5300);  // 2300 still owed + 3000 for the period ending on the 30th
  // paying ahead lowers the next pay
  d.payments.push({ id: 'p3', empId: 'e1', paidOn: '2026-11-23', net: 3000, method: 'Cash' });
  a = C.account(d, e, '2026-11-23');
  assert.equal(a.owed, -700);
  assert.equal(a.nextPay, 2300);
});

test('running account starts from an opening balance', () => {
  const d = C.blankData();
  d.settings.since = '2026-11-21';
  const e = emp({ schedule: 'weekly', payDay: 5, rate: 2000, opening: 450 });
  d.employees.push(e);
  const a = C.account(d, e, '2026-11-23');
  assert.equal(a.earned, 450);   // first pay day (27 Nov) has not come yet
  assert.equal(a.owed, 450);
  assert.equal(a.nextPay, 2450);
});

test('present by default: unmarked working days count as present; only exceptions are tapped', () => {
  const d = C.blankData();
  d.settings.since = '2026-11-01';
  assert.equal(d.settings.autoPresent, true);
  const e = emp({ payType: 'daily', schedule: 'weekly', payDay: 5, rate: 300, workDays: [1, 2, 3, 4, 5] });
  d.employees.push(e);
  C.setMark(d, '2026-11-24', 'e1', { s: 'A' }); // the one exception
  const r = C.calcPeriod(d, e, C.periodFor(e, '2026-11-23'), '2026-11-26'); // Sat 21 – Fri 27
  // Mon 23, Wed 25, Thu 26 automatic; Tue 24 absent; Fri 27 still to come
  assert.equal(r.counts.P, 3);
  assert.equal(r.counts.auto, 3);
  assert.equal(r.counts.unrecorded, 0);
  assert.equal(r.gross, 900);
  const day = C.daySummary(d, '2026-11-23');
  assert.equal(day.missing, 0);
  assert.equal(day.counts.P, 1);
  // a day after today is not filled in yet, and switching it off brings back "not marked"
  assert.equal(C.autoPresent(d, e, '2026-12-01', '2026-11-26'), false);
  d.settings.autoPresent = false;
  assert.equal(C.calcPeriod(d, e, C.periodFor(e, '2026-11-23'), '2026-11-26').counts.unrecorded, 3);
});
