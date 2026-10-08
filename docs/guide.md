# ShiftKnit user guide

[繁體中文版](guide.zh-Hant.md)

ShiftKnit builds a staff rota from your rules and checks every rota rule by rule with
an independent checker before showing it. Everything runs in your browser; nothing is
uploaded.

> **Not legal advice.** "Passes the check" only means the rota follows the rules you
> entered. It does not mean it complies with any law or contract. See
> [the Hong Kong rest-day preset](hk-rest-day.md).

## 1. Open ShiftKnit

- **Online:** open the published site (see the README). After the first visit it also
  works offline.
- **On your own computer** (Node.js 22 or later):

```sh
npm ci
npm start   # builds the site and serves it at http://127.0.0.1:4883/
```

- **Docker:** see the README. The container only serves the static site.

## 2. Set up

1. **Project:** name, time zone (an IANA name such as `Asia/Hong_Kong`), first day and
   number of days (1–31), minimum rest between shifts, and the rest-day rule.
2. **Skills:** for example `keyholder, first aid` or `急救`. Up to 8.
3. **Shifts** (up to 6): start and end time (a shift that ends at or before its start
   time ends the next day, e.g. 22:00–07:00), unpaid break, staff needed on each
   weekday, and an optional skill need ("must include at least 1 keyholder").
4. **Staff** (up to 30): name or code, skills, maximum and minimum hours per week,
   maximum days in a row, leave dates, and weekdays they prefer not to work.
   Availability windows and other preferences can be set in the project file (see
   the examples).

Use **Load sample** to try a small café, or open one of the files in `examples/`:
`small-shop.json`, `care-home-nights.json` (12-hour day and night shifts) and
`volunteer-team.json` (London time, across the October clock change).

## 3. Make the rota

Press **Make rota**. The solver runs in the background, so the page stays usable; press
**Stop** to cancel. The result is labelled honestly:

| Label                          | Meaning                                                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| **Proven best**                | Every staffing need is met and the search proved no better rota exists under your rules.                       |
| **Feasible (not proven best)** | Every need is met; the search stopped before it could prove this is the best.                                  |
| **Best found, with gaps**      | Some places cannot be filled. If ShiftKnit can prove full staffing is impossible, it says so and explains why. |
| **No solution**                | No rota can follow all of your hard rules (for example, two locks that clash).                                 |

Every rota shown has passed the independent checker. If the solver ever produced a rota
the checker rejects, the rota is withheld and the page says so.

### Why this rota? Why no rota?

When full staffing (or any rota at all) is proven impossible, ShiftKnit searches for a
**small set of your rules that cannot all be met at once**. For example, if three of
the four keyholders in the sample café are on leave on the same Wednesday:

- Opening on 2026-11-04 needs 1 staff with keyholder.
- Closing on 2026-11-04 needs 1 staff with keyholder.
- Ada is on leave on 2026-11-04.
- Chloe is on leave on 2026-11-04.
- Fai is on leave on 2026-11-04.

(Dev, the remaining keyholder, cannot work both overlapping shifts.)

Each explanation is proven by exhaustive search on the period it names. "Minimal"
means dropping any one rule removes the conflict. Relax one of them (more staff, a
different skill mix, fewer hours needed) and try again.

### Hard rules

| Rule          | Checked as                                                                                                                                      |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Availability  | The whole shift must fit inside one of the person's windows (if any are set).                                                                   |
| Leave         | No shift may overlap a leave day (local calendar day).                                                                                          |
| Overlap       | One person's shifts may not overlap.                                                                                                            |
| Rest          | Minimum time between the end of one shift and the start of the next, across midnight.                                                           |
| Weekly hours  | Worked minutes (break excluded) per week; daylight-saving changes count exactly. The minimum applies only to weeks fully inside the period.     |
| Days in a row | Maximum consecutive working days (by shift start day).                                                                                          |
| Rest days     | At least N rest days of at least 24 continuous hours off in every 7 days: either any 7 days in a row, or fixed 7-day blocks from the first day. |
| Staffing      | Never more people than needed. Too few is reported as a gap, not hidden.                                                                        |
| Locks         | A locked cell keeps its shift (or day off).                                                                                                     |

### Preferences and fairness (soft)

After filling as many places as possible, ShiftKnit lowers a score made of: preferences,
the spread of hours, weekend shifts and night shifts between people, changes from a
previous rota (project file), and single days off between work days. The score is shown
with a breakdown; lower is better.

## 4. Edit by hand

Change any cell in the **Staff × days** grid. The same checker runs after every change
and marks broken rules in red, with a sentence for each. Use the □ button to **lock** a
cell, then **Make rota** again to fill in the rest around your choices. **Week calendar**
shows who works each shift.

## 5. Export and print

- **CSV** (staff × days, a list with hours, or unfilled needs). Any cell starting with
  `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading apostrophe so that
  spreadsheets cannot run it as a formula.
- **Calendar file (.ics)** per person, for phone calendars. Times are written in UTC, so
  overnight shifts and clock changes are exact.
- **Project file (.json)** to back up or share your set-up, and **Rota (.json)**.
- **Print:** team rota, one page per person, and a **rest-day roster** listing each
  person's rest days for posting in advance.

## 6. Command line

The same core runs from the command line:

```sh
npm run shiftknit -- solve examples/small-shop.json --seed 1 --time-limit 10s --out result.json --text
npm run shiftknit -- check examples/small-shop.json result.json --text
npm run shiftknit -- export examples/small-shop.json result.json --format ics --staff ada --out ada.ics
npm run shiftknit -- export examples/small-shop.json result.json --format csv-list --out rota.csv
```

Exit codes: 0 ok; 1 bad input; 2 broken rules (`check`) or unfilled places (`solve`);
3 no rota; 4 internal check failed. Results are the same for the same project and seed
unless the time limit is reached.

## 7. Your data

The project and rota are stored in this browser (IndexedDB); display settings in
`localStorage`. **Delete all data on this device** removes both. ShiftKnit makes no
requests to any other site.

## 8. Limits in v0.1

30 staff, 31 days, 6 shifts, 8 skills, one shift per person per day. No logins, shift
swapping, payroll or notifications.
