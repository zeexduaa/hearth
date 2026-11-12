# Roadmap

hearth already covers belongings, warranties, receipts, supplies, upkeep, chores, bills and an
insurance inventory. This is what's left, roughly in order. Ideas and help are welcome.

## Next

- [ ] **Photos in the inventory.** Attach photos to items and show them in the HTML report,
      since insurers like pictures. Include a one-command "walk through each room" mode.
- [ ] **Reminders that reach you.** A daily desktop notification and an optional email digest
      of what's due, with snooze.
- [ ] **Calendar export.** Bills and tasks as an `.ics` file, or a subscribed feed, for phone
      calendars.
- [ ] **Encryption at rest.** An optional passphrase (scrypt + AES-256-GCM from `node:crypto`)
      for the data file and attachments.
- [ ] **Shared households.** Safe use of one file from several computers (in a synced folder),
      with changes merged by record instead of last-save-wins.
- [ ] **Replacement value.** Depreciation by category and a "replacement cost" column, because
      insurers pay on different bases.
- [ ] **Import** from spreadsheets (CSV with column mapping) and from other inventory apps.
- [ ] **Shell completion** for item, task and bill names.

## Later

- [ ] **A local web app** (`hearth serve`): today's list, the shopping list on a phone over
      Wi-Fi, and charts of spending.
- [ ] **Barcode lookup** to fill in product details when adding supplies.
- [ ] **Budgets** per category of bill, with year-over-year comparisons.
- [ ] **Maintenance guides.** Starter task sets for a new home (filters, gutters, smoke alarms,
      boiler service) that you can choose from.
- [ ] **Moving house.** Pack lists by box, and an "everything in box 12" view.
- [ ] **Translations** and other date formats.

## Done

- [x] Calendar dates and recurrences that handle month ends, nth weekdays and months of the
      year.
- [x] Exact money in whole cents, per currency.
- [x] Items with locations, values, serial numbers and warranties; supplies with a shopping
      list.
- [x] Upkeep (fixed and after-done) and chores that rotate among the household.
- [x] Bills with real amounts, overdue tracking, spending history and unusual-amount alerts.
- [x] Receipts kept safe in a de-duplicated, checked folder.
- [x] Insurance inventory (terminal, printable HTML, CSV), exports and a command line for all
      of it.
