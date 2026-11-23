# Nazeer's Motor Spares — staff attendance & pay

This app replaces keeping attendance in a WhatsApp chat. Each morning the owner taps Present / Late / Absent next to each name. The app then works out each person's pay for their own pay schedule (monthly, every two weeks or weekly), including absences, half days, overtime and advances.

## Using it

Open **https://777naeem-prog.github.io/nazeers-attendance/** — see *On the phones* below for setting up the family's phones.

1. **Staff**: add each employee with their name, role, pay and how pay is worked out:
   - **Fixed salary**: a set amount per pay period. Absent days and half days are deducted at *salary ÷ working days in the period*.
   - **Daily rate**: paid for each day marked Present, Late, Sick or Leave. A half day pays half.
   - **Paid**: monthly (pick the pay day, e.g. the 25th or the last day), **on set dates each month** (e.g. `10, 20, 30` — the monthly salary is split evenly over them; 30/31 means month-end in short months), every two weeks (pick the weekday and one real pay date), or weekly (pick the weekday).
   - *Started on*: only for someone new; leave it empty for people who already worked there. *Already owed to them*: wages from before the app that are still unpaid (a minus amount if they owe the shop).
   - Also: normal working days (Mon–Sat by default), overtime pay per hour, and an optional amount deducted for each late arrival.
2. **Daily register**: one screen per day. Tap a status for each person, or press *Mark the rest present*, then add any overtime hours or a note. *Send on WhatsApp* shares the day's register as a message, so the staff group can still see it. *Shop closed* marks public holidays and other closed days: nobody is counted absent, salaries are not reduced, and daily-rate staff are not paid that day.
3. **Month sheet**: the whole month as a grid with totals per person. Tap a square to change it. A dot means a working day that has not been marked. You can print it.
4. **Pay** — a running account per person, so money can be paid **any day, in any amount** (a sliding scale):
   - **Everyone at a glance** at the top: per person *Earned* (every pay day so far), *Paid* (everything handed over, on pay day or in between) and *To pay*, with a bar showing how much has been paid, and the totals for everyone.
   - Each person's card: Earned · Paid · To pay now, the next pay day and what will be due then (paying ahead lowers it), this period's attendance and how the amount was worked out, and every payment (tap × to remove a mistake).
   - *Pay*: any amount, any date, cash or bank, with an optional note — part of the wages, the full amount, or money in between pay days. Shortcuts fill in "still owed" or "up to the next pay day".
   - *Pay slip* (print) or *WhatsApp*: the last pay period — what was earned, what was paid, and the balance.
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

## On the phones (Android and iPhone)

The app lives at **https://777naeem-prog.github.io/nazeers-attendance/** (published by GitHub Pages from this repository; every change pushed to `main` goes live within a minute or two). It works the same on Android and iPhone.

**For the owner's family only, with one shared login.** Nazeer and his sons all use the same login, so every phone shows the same register and pay — whoever updates it, the others see it within about a minute. There are no usernames or passwords: each phone is set up once with the private **setup link**, and each person chooses their own **4-digit PIN** for their own phone.

1. **Tap the setup link** on the phone (on an iPhone, open it in **Safari**).
2. **Choose a PIN** (typed twice).
3. **Add it to the home screen** — Chrome: ⋮ → *Add to Home screen*. Safari: Share → *Add to Home Screen*. On the iPhone, always use the home-screen icon: Safari can clear a website's saved data after a week without a visit, but not an app on the home screen.

The app locks itself after two minutes in the background (or *Settings → Lock now*); after five wrong PINs it makes you wait, longer each time. Without signal it keeps working and sends the changes later. If two phones mark the same person on the same day, the last change wins.

**Settings → Family phones**
- *Send the setup link* — add another phone (a son's phone, a new phone).
- *Make a new link* — for a lost or stolen phone: every other phone is signed out at once (this one stays on); send the new link to the phones that should keep using the app.
- *Forgot PIN?* — tap the setup link again on the phone and choose a new PIN. Nothing is lost.
- *Remove this phone* — takes the shop's records off the phone (they stay in the cloud); warns first if a change has not reached the cloud yet.

Treat the setup link like a key: send it only to the family.

### Behind the scenes

Records are shared through Nazeer's own Supabase project (**nazeers-parts-board**); only members can read or write them, and there is one member — the shared login `nazeer` (account `nazeer@nms-staff.invalid`; no e-mail is ever sent). The setup link is `…/#join=nazeer.<secret>`; the part after `#` never leaves the phone except to sign in. Each PIN is stored only on its own phone, hashed.

If every phone and the link are lost, an administrator sets a new secret in the Supabase *SQL Editor* and builds the link `https://777naeem-prog.github.io/nazeers-attendance/#join=nazeer.<new secret>`:

```sql
update auth.users set encrypted_password = extensions.crypt('<new secret, 32 random characters>', extensions.gen_salt('bf'))
where email = 'nazeer@nms-staff.invalid';
delete from auth.sessions where user_id = (select id from auth.users where email = 'nazeer@nms-staff.invalid');
```

The database setup is in `supabase/` (all already applied).

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
