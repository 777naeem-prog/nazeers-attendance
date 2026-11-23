# Nazeer's Motor Spares — staff attendance & pay

This app replaces keeping attendance in a WhatsApp chat. Each morning the owner taps Present / Late / Absent next to each name. The app then works out each person's pay for their own pay schedule (monthly, every two weeks or weekly), including absences, half days, overtime and advances.

## Using it

Open **`index.html`** in Chrome, Edge or Safari. It works offline. To use it on phones and share records between Nazeer and the manager, see *On the phones* below.

1. **Staff**: add each employee with their name, role, pay and how pay is worked out:
   - **Fixed salary**: a set amount per pay period. Absent days and half days are deducted at *salary ÷ working days in the period*.
   - **Daily rate**: paid for each day marked Present, Late, Sick or Leave. A half day pays half.
   - **Paid**: monthly (pick the pay day, e.g. the 25th or the last day), every two weeks (pick the weekday and one real pay date), or weekly (pick the weekday).
   - Also: normal working days (Mon–Sat by default), overtime pay per hour, and an optional amount deducted for each late arrival.
2. **Daily register**: one screen per day. Tap a status for each person, or press *Mark the rest present*, then add any overtime hours or a note. *Send on WhatsApp* shares the day's register as a message, so the staff group can still see it. *Shop closed* marks public holidays and other closed days: nobody is counted absent, salaries are not reduced, and daily-rate staff are not paid that day.
3. **Month sheet**: the whole month as a grid with totals per person. Tap a square to change it. A dot means a working day that has not been marked. You can print it.
4. **Pay**: each employee's current pay period with a full breakdown, the amount to pay and how many days until pay day. Use the arrows to look at earlier periods.
   - *Give advance*: money handed over early is taken off that period's pay.
   - *Mark as paid*: records the amount, the date and how it was paid (the amount can be adjusted).
   - *Print pay slip* or *WhatsApp pay slip* gives the employee a slip.
5. **Settings**: business name, currency, the date attendance started being kept here, a list of closed days, and **backups**.

### Statuses

| Code | Meaning | Salary staff | Daily-rate staff |
|---|---|---|---|
| P | Present | paid | paid |
| L | Late | paid (minus late deduction, if set) | paid (minus late deduction, if set) |
| H | Half day | half a day deducted | half a day paid |
| A | Absent | a day deducted | not paid |
| S | Sick (paid) | paid | paid |
| V | Leave (paid) | paid | paid |
| O | Day off | not counted | not paid |

If someone works on a day off or on a day the shop was closed, they are paid an extra day.

## On the phones (Honor and iPhone)

It is a web app, so it works the same on Android (Chrome on Nazeer's Honor) and iPhone (Safari on the manager's phone).

1. **The address.** It is published by GitHub Pages from this repository: **https://777naeem-prog.github.io/nazeers-attendance/** — every change pushed to `main` goes live within a minute or two.
2. **Install it on each phone.** Open the address, then:
   - **Honor / Android (Chrome):** ⋮ menu → *Add to Home screen* (or *Install app*).
   - **iPhone (Safari):** Share button → *Add to Home Screen*. Do use the home-screen icon on the iPhone: Safari can clear a website's saved data after a week without a visit, but not an app added to the home screen.
3. **Sign in.** The app opens on a sign-in screen; nothing else is visible until **nazeer** or **manager** signs in, each with **their own** username and password. Signing out (Settings) removes the shop's records from that phone — they stay in the cloud — and warns first if any change has not reached the cloud yet. Both phones then show the same register, month sheet and pay. Changes reach the other phone within about a minute (or press *Sync now*). Without signal the app keeps working and sends the changes later.

If both people mark the same person on the same day, the last change wins. Different people or different days never clash.

### Logins

Records are shared through Nazeer's own Supabase project (**nazeers-parts-board**). Only accounts listed as members can see or change anything.

Two logins exist: **nazeer** (owner) and **manager**. They sign in with the username alone; no e-mail address is needed or ever used (behind the scenes they are `nazeer@nms-staff.invalid` and `manager@nms-staff.invalid`). Each was given a temporary password, and the app makes them choose their own the first time they sign in.

To add another person, run in the Supabase *SQL Editor* (change the username, temporary password, role and name):

```sql
do $$ declare uid uuid := gen_random_uuid(); begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', 'cashier@nms-staff.invalid', extensions.crypt('temporary-pass-123', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{"must_change_password": true}', now(), now(), '', '', '', '', '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at)
  values (gen_random_uuid(), uid, uid::text, jsonb_build_object('sub', uid::text, 'email', 'cashier@nms-staff.invalid', 'email_verified', true), 'email', now(), now());
  insert into public.nms_members (user_id, role, name) values (uid, 'manager', 'Cashier');
end $$;
```

A forgotten password: set a new temporary one the same way (`update auth.users set encrypted_password = extensions.crypt('new-temp-pass', extensions.gen_salt('bf')), raw_user_meta_data = raw_user_meta_data || '{"must_change_password": true}' where email = 'manager@nms-staff.invalid';`). To remove someone: *Authentication* → *Users* → delete; they lose access straight away.

The database setup is in `supabase/001_nms_attendance_sync.sql` (already applied).

### Backups

The cloud keeps a copy once you are signed in, but a backup file is still worth having: **Settings → Download backup** now and then, and keep the file somewhere safe. *Restore from backup* loads it again.

## Adding it to another system

The module is built so it can be dropped into another of Nazeer's Motor Spares' systems:

| File | What it is |
|---|---|
| `attendance-core.js` | The engine: pay periods, pay calculation, WhatsApp text. No screen code. Works in the browser (`NMSAttendanceCore`) and in Node (`require`). |
| `attendance-ui.js` | The screens. `NMSAttendance.mount(element, options)` draws everything inside one element. |
| `attendance-sync.js` | Optional cloud sync. `NMSSync.create({ url, key })` gives a `storage` and `cloud` to pass to `mount`. |
| `attendance.css` | Styles. Every rule is scoped to `.nms-att`, so it does not change the host's look. |
| `index.html` + `start.js`, `sw.js`, `manifest.webmanifest`, `icons/` | The stand-alone app, installable on a phone and usable offline. |
| `embed-example.html` + `embed-example.js` | A working example of mounting it inside another page. |

```html
<link rel="stylesheet" href="attendance/attendance.css">
<div id="staff-attendance"></div>
<script src="attendance/attendance-core.js"></script>
<script src="attendance/attendance-ui.js"></script>
<script>
  const att = NMSAttendance.mount(document.getElementById('staff-attendance'), {
    storage: { load: () => /* saved object or null */, save: (data) => { /* store it in the host's database */ } },
    onChange: (data) => { /* optional: react to every change */ },
  });
  // att.getData(), att.setData(data), att.reload(), att.show('pay'), att.payFor(employeeId, '2026-11-25'), att.destroy()
</script>
```

Without a `storage` option, data goes to `localStorage` under `nms-attendance-v1`.

**Data format** (one JSON object, also the backup file):

- `employees[]`: `{ id, name, role, phone, idNo, startDate, endDate, active, payType: 'salary'|'daily', rate, schedule: 'monthly'|'fortnightly'|'weekly', payDay, anchor, workDays: [0–6], otRate, lateDeduct }`
- `marks`: `{ 'YYYY-MM-DD': { employeeId: { s: 'P'|'L'|'H'|'A'|'S'|'V'|'O', ot: hours, note } } }`
- `closed`: `{ 'YYYY-MM-DD': 'reason' }`
- `advances[]`: `{ id, empId, date, amount, note }`
- `payments[]`: `{ id, empId, start, end, paidOn, method, net, calculated, note }`

A host system can work out pay without showing any screens:

```js
const C = require('./attendance-core.js');           // or window.NMSAttendanceCore
const emp = data.employees[0];
const result = C.calcPeriod(data, emp, C.periodFor(emp, '2026-11-25'));
// result.net, result.lines, result.counts, result.payment …
```

## Tests

```
node --test test/*.test.js
```
