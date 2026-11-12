import { test } from "node:test";
import assert from "node:assert/strict";
import * as d from "../src/dates.js";
import * as money from "../src/money.js";

test("dates", () => {
  assert.equal(d.parseDate("2028-02-29"), "2028-02-29");
  assert.throws(() => d.parseDate("2027-02-29"), /isn't a real date/);
  assert.equal(d.parseDate("tomorrow", "2026-12-31"), "2027-01-01");
  assert.equal(d.parseDate("in 2 weeks", "2026-03-01"), "2026-03-15");
  assert.equal(d.parseDate("in 1 month", "2026-01-31"), "2026-02-28");
  assert.equal(d.addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(d.addMonths("2028-01-31", 1), "2028-02-29");
  assert.equal(d.addMonths("2026-03-15", -3), "2025-12-15");
  assert.equal(d.relative("2026-03-04", "2026-03-01"), "in 3 days");
  assert.equal(d.relative("2026-02-27", "2026-03-01"), "2 days ago");
  assert.equal(d.today(Date.UTC(2026, 0, 1, 3), "America/Los_Angeles"), "2025-12-31");
});

test("reads recurrences as people say them", () => {
  assert.deepEqual(d.parseRecurrence("monthly"), { every: 1, unit: "month" });
  assert.deepEqual(d.parseRecurrence("every 3 months"), { every: 3, unit: "month" });
  assert.deepEqual(d.parseRecurrence("every other week"), { every: 2, unit: "week" });
  assert.deepEqual(d.parseRecurrence("quarterly"), { every: 3, unit: "month" });
  assert.deepEqual(d.parseRecurrence("monthly on the 15th"), { every: 1, unit: "month", day: 15 });
  assert.deepEqual(d.parseRecurrence("Monthly on the last day"), { every: 1, unit: "month", day: "last" });
  assert.deepEqual(d.parseRecurrence("monthly on the 2nd tuesday"), { every: 1, unit: "month", nth: { n: 2, weekday: "tue" } });
  assert.deepEqual(d.parseRecurrence("every month on the last friday"), { every: 1, unit: "month", nth: { n: -1, weekday: "fri" } });
  assert.deepEqual(d.parseRecurrence("yearly in October"), { every: 1, unit: "year", month: 10 });
  assert.throws(() => d.parseRecurrence("sometimes"), /can't read/);
  assert.throws(() => d.parseRecurrence("weekly on the 15th"), /only makes sense for monthly or yearly/);
  assert.throws(() => d.parseRecurrence("monthly on the 32nd"), /1 to 31/);
});

test("month ends don't drift", () => {
  const rent = d.parseRecurrence("monthly");
  assert.deepEqual(d.between(rent, "2026-01-31", "2026-01-01", "2026-05-31"),
    ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
  const last = d.parseRecurrence("monthly on the last day");
  assert.deepEqual(d.between(last, "2028-01-10", "2028-01-01", "2028-03-31"), ["2028-01-31", "2028-02-29", "2028-03-31"]);
});

test("fixed days, nth weekdays and months of the year", () => {
  const mid = d.parseRecurrence("monthly on the 15th");
  assert.equal(d.nextOnOrAfter(mid, "2026-03-20", "2026-03-20"), "2026-04-15");     // not before the start
  const meeting = d.parseRecurrence("monthly on the 2nd tuesday");
  assert.deepEqual(d.between(meeting, "2026-01-01", "2026-01-01", "2026-03-31"), ["2026-01-13", "2026-02-10", "2026-03-10"]);
  const lastFri = d.parseRecurrence("monthly on the last friday");
  assert.deepEqual(d.between(lastFri, "2026-01-01", "2026-01-01", "2026-02-28"), ["2026-01-30", "2026-02-27"]);
  const gutters = d.parseRecurrence("yearly in october");
  assert.deepEqual(d.between(gutters, "2026-03-05", "2026-01-01", "2028-12-31"), ["2026-10-05", "2027-10-05", "2028-10-05"]);
  const filter = d.parseRecurrence("every 3 months");
  assert.equal(d.nextOnOrAfter(filter, "2026-01-10", "2026-11-12"), "2027-01-10");
  assert.equal(d.after(filter, "2026-11-30"), "2027-02-28");
});

test("descriptions", () => {
  for (const text of ["monthly", "every 3 months", "every 2 weeks", "yearly"]) {
    assert.equal(d.describeRecurrence(d.parseRecurrence(text)), text);
  }
  assert.equal(d.describeRecurrence(d.parseRecurrence("monthly on the 1st")), "monthly on the 1st");
  assert.equal(d.describeRecurrence(d.parseRecurrence("monthly on the last fri")), "monthly on the last Friday");
  assert.equal(d.describeRecurrence(d.parseRecurrence("every 2 years in march")), "every 2 years in March");
});

test("money is exact and per currency", () => {
  assert.deepEqual(money.parseMoney("12.5", "usd"), { cents: 1250, currency: "USD" });
  assert.deepEqual(money.parseMoney("$1,234.56", "EUR"), { cents: 123456, currency: "USD" });
  assert.deepEqual(money.parseMoney("30 eur", "USD"), { cents: 3000, currency: "EUR" });
  assert.deepEqual(money.parseMoney("€30", "USD"), { cents: 3000, currency: "EUR" });
  assert.deepEqual(money.parseMoney("Rs 2500", "USD"), { cents: 250000, currency: "PKR" });
  assert.deepEqual(money.parseMoney("5000 JPY", "USD"), { cents: 5000, currency: "JPY" });
  assert.deepEqual(money.parseMoney("$.99", "USD"), { cents: 99, currency: "USD" });
  assert.deepEqual(money.parseMoney("rs 2500", "USD"), { cents: 250000, currency: "PKR" });
  assert.throws(() => money.parseMoney("12.345", "USD"), /2 decimal places/);
  assert.throws(() => money.parseMoney("twelve", "USD"), /isn't an amount/);
  assert.throws(() => money.parseMoney("1,23.4", "USD"), /isn't an amount/);
  const sum = money.totals([money.parseMoney("0.10", "USD"), money.parseMoney("0.20", "USD"), money.parseMoney("€5", "USD")]);
  assert.deepEqual(sum, [{ currency: "EUR", cents: 500 }, { currency: "USD", cents: 30 }]);
  assert.equal(money.formatTotals(sum), "€5.00 + $0.30");
  assert.equal(money.formatMoney({ cents: 250000, currency: "PKR" }), "2,500.00 PKR");
  assert.equal(money.formatMoney({ cents: -1999, currency: "GBP" }), "-£19.99");
});
