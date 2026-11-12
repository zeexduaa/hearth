# hearth

**A private home and household manager for the command line.** It keeps track of what you own
and where it is, when warranties run out, the upkeep a home needs, whose turn it is for the
chores, which bills are due, and what's running low. When you need it most, after a burglary,
a flood or a fire, it gives you a room-by-room inventory with serial numbers, prices and
receipts for the insurer. Everything stays in one file on your own computer.

```console
$ hearth
12 Oak Road, 2026-11-12

Overdue
  Rent $1,450.00: overdue since 2026-11-01 (11 days ago)
  Furnace filter: overdue since 2026-11-01 (11 days ago)

Coming up (next 14 days)
  Bins out: due 2026-11-12 (today), Syed's turn
  Electricity: due 2026-11-20 (in 8 days)

Warranties
  Fridge: ends 2026-12-01 (in 19 days)

Shopping
  Toilet paper: buy 13 rolls (have 5)

Bills out of the ordinary
  Electricity: $131.50 on 2026-10-21, 64% above the usual $80.00
```

## What it does

- **Belongings.**
  - Record where each thing is (`Garage / Shelf 2`) and what it cost.
  - Keep the brand, model, serial number, purchase date and store.
  - Ask `hearth where drill`, or see every room with its item counts and values.
- **Warranties and receipts.**
  - Say `--warranty "2 years"` and hearth works out the last day covered.
  - It warns before a warranty ends.
  - `hearth attach receipt.pdf --to fridge` keeps a copy of the receipt, so it's there when you
    need it.
- **Supplies and shopping.**
  - Give household supplies a minimum, then use and buy them.
  - `hearth shopping` lists what's low and how many to get.
- **Upkeep and chores.**
  - Calendar tasks (bins every Tuesday, smoke alarms on the 1st) and tasks due after the last
    time (furnace filter every 3 months, counted from the actual change).
  - Missed weeks don't pile up.
  - Chores can take turns among the household, and swaps and skips are handled fairly.
- **Bills.**
  - Due dates that follow real calendars (`monthly on the last day`, `monthly on the 2nd
    tuesday`; a bill on the 31st falls on 28 February).
  - Record what was actually paid, and see a monthly estimate and spending over time.
  - An alert when a bill is far above or below its usual amount.
- **The insurance inventory.**
  - `hearth report --html inventory.html` gives a printable page, room by room, with totals.
  - It points out what would make a claim harder: items without a price, or valuable items
    without a serial number.
- **Exports** to CSV for items, payments and upkeep history.

## Install

You need [Node.js](https://nodejs.org) 20 or newer.

```console
$ git clone https://github.com/zeexduaa/hearth
$ cd hearth
$ npm install          # also builds it
$ npm install -g .     # puts the hearth command on your PATH
$ hearth init --home "12 Oak Road" --currency USD
```

The same commands work in PowerShell on Windows.

## A first ten minutes

```console
$ hearth item add Fridge --in Kitchen --price 899 --bought 2025-12-20 --warranty "2 years" --brand Samsung --serial RF28-0042
$ hearth attach ~/Downloads/fridge-receipt.pdf --to fridge
$ hearth item add "Toilet paper" --in Bathroom --qty 8 --unit rolls --min 6 --restock 18
$ hearth member add Syed
$ hearth member add Aisha
$ hearth task add "Bins out" --every weekly --fixed --who syed,aisha --rotate
$ hearth task add "Replace furnace filter" --every "every 3 months"
$ hearth task add "Test smoke alarms" --every "monthly on the 1st" --fixed
$ hearth bill add Rent --every "monthly on the 1st" --amount 1450
$ hearth bill add Electricity --every "monthly on the 20th" --payee "City Power"
```

After that, day to day: `hearth` shows what needs doing. Then `hearth done bins`,
`hearth paid electricity 92.10`, `hearth use "toilet paper" 2` and `hearth buy "toilet paper" 12`.
Run `hearth help` for everything.

**Dates** can be `YYYY-MM-DD`, `today`, `tomorrow`, `yesterday` or `in 3 days`. **Repeats** can be
`weekly`, `monthly`, `quarterly`, `yearly`, `every 2 weeks`, `every 6 months`, `monthly on the 15th`,
`monthly on the last day`, `monthly on the last friday` or `yearly in october`. **Amounts** can be
`12.50`, `$1,234.56`, `30 EUR`, `€30` or `Rs 2500`. Each currency is totalled separately.

## Your data

Everything is in one JSON file: `%APPDATA%\hearth\hearth.json` on Windows,
`~/Library/Application Support/hearth/` on macOS, `~/.local/share/hearth/` on Linux. Attached
files go in a `hearth-files` folder beside it. Use `--file` or `HEARTH_FILE` for another
location, such as a synced folder you share with your household.

- Saves are atomic, and the previous version is kept as `hearth.json.bak`.
- On macOS and Linux the files are readable only by you.
- hearth makes no network connections and has no runtime dependencies.
- The data isn't encrypted (see the roadmap), so rely on your disk encryption.
- **Back it up**, including the files folder. An inventory is only useful if it survives the
  thing you're insuring against. Keep a copy of `hearth report --html` somewhere else, such as
  cloud storage or email.

## Development

```console
$ npm install
$ npm test             # compiles, then runs the tests with Node's built-in runner
```

The code is strict TypeScript with no runtime dependencies. See [ROADMAP.md](ROADMAP.md) for
what's next.

## License

MIT
