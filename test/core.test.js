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
