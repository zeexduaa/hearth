import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as bills from "../src/bills.js";
import * as att from "../src/attachments.js";
import { parseRecurrence } from "../src/dates.js";
import { emptyData } from "../src/model.js";
import { parseMoney } from "../src/money.js";

const usd = (t: string) => parseMoney(t, "USD");

test("due dates, paying, and what's open", () => {
  const data = emptyData("Home");
  const rent = bills.addBill(data, { name: "Rent", recurrence: parseRecurrence("monthly on the 1st"), start: "2026-10-01",
                                     amount: usd("1,450") }, "2026-09-20");
  const power = bills.addBill(data, { name: "Electricity", recurrence: parseRecurrence("monthly on the 20th"), start: "2026-10-20" }, "2026-09-20");
  bills.addBill(data, { name: "Internet", recurrence: parseRecurrence("monthly on the 5th"), start: "2026-10-05", amount: usd("60"),
                        autopay: true }, "2026-09-20");
  bills.pay(rent, { paid: "2026-09-30" });
  bills.pay(power, { paid: "2026-10-21", amount: usd("88.40") });
  // 2026-11-12: November rent is overdue; electricity due on the 20th; internet is autopay so its past dates aren't open.
  assert.deepEqual(bills.upcoming(data, "2026-11-12", 10).map((s) => [s.bill.name, s.due, s.daysLeft]),
    [["Rent", "2026-11-01", -11], ["Electricity", "2026-11-20", 8]]);
  const paid = bills.pay(rent, { paid: "2026-11-12", note: "late, sorry" });
  assert.equal(paid.due, "2026-11-01");
  assert.throws(() => bills.pay(rent, { paid: "2026-11-12", due: "2026-11-01" }), /already paid/);
  assert.throws(() => bills.pay(rent, { paid: "2026-11-12", due: "2026-11-02" }), /isn't due on 2026-11-02/);
  assert.throws(() => bills.pay(power, { paid: "2026-11-12" }), /how much/);
  assert.equal(bills.undoPayment(rent).due, "2026-11-01");
  assert.throws(() => bills.addBill(data, { name: "rent", recurrence: parseRecurrence("monthly"), start: "2026-01-01" }, "2026-01-01"), /already a bill/);
});

test("due dates before the bill was added aren't unpaid", () => {
  const data = emptyData("Home");
  bills.addBill(data, { name: "Water", recurrence: parseRecurrence("every 2 months"), start: "2026-01-15", amount: usd("45") }, "2026-11-12");
  // Due in Jan, Mar, May, Jul and Sep before it was added on 2026-11-12: none of those are "unpaid".
  assert.deepEqual(bills.upcoming(data, "2026-11-12", 2).map((s) => s.due), []);
  assert.deepEqual(bills.upcoming(data, "2026-11-12", 30).map((s) => s.due), ["2026-11-15"]);
});

test("a loan stops after its last payment", () => {
  const data = emptyData("Home");
  const loan = bills.addBill(data, { name: "Car loan", recurrence: parseRecurrence("monthly"), start: "2026-09-10",
                                     end: "2026-12-10", amount: usd("310") }, "2026-09-01");
  assert.deepEqual(bills.dueDates(loan, "2026-01-01", "2027-12-31"), ["2026-09-10", "2026-10-10", "2026-11-10", "2026-12-10"]);
  assert.equal(bills.nextDue(loan, "2026-12-11"), undefined);
});

test("spending per month, unusual bills and a monthly estimate", () => {
  const data = emptyData("Home");
  const power = bills.addBill(data, { name: "Electricity", recurrence: parseRecurrence("monthly on the 20th"), start: "2026-05-20" }, "2026-05-01");
  for (const [month, amount] of [["05", "100"], ["06", "110"], ["07", "90"], ["08", "100"], ["09", "150"]] as const) {
    bills.pay(power, { paid: `2026-${month}-20`, amount: usd(amount) });
  }
  assert.deepEqual(bills.unusual(data).map((u) => [u.bill.name, u.percent, u.average.cents]), [["Electricity", 50, 10000]]);
  const months = bills.spending(data, "2026-09-30", 3);
  assert.deepEqual(months.map((m) => [m.month, m.total[0]?.cents]), [["2026-07", 9000], ["2026-08", 10000], ["2026-09", 15000]]);
  bills.addBill(data, { name: "Rent", recurrence: parseRecurrence("monthly"), start: "2026-01-01", amount: usd("1000") }, "2026-01-01");
  bills.addBill(data, { name: "Insurance", recurrence: parseRecurrence("yearly"), start: "2026-01-01", amount: usd("600") }, "2026-01-01");
  assert.deepEqual(bills.monthlyEstimate(data, "2026-09-30"), [{ currency: "USD", cents: 105000 }]);
});

test("attachments are copied, de-duplicated and checked", () => {
  const dir = mkdtempSync(join(tmpdir(), "hearth-att-"));
  const files = join(dir, "files");
  writeFileSync(join(dir, "receipt fridge (1).pdf"), "%PDF fake receipt");
  const data = emptyData("Home");
  const a = att.attach(data, files, join(dir, "receipt fridge (1).pdf"), "2026-11-12", { item: "fridge-id", note: "Currys" });
  assert.match(a.file, /^[0-9a-f]{12}-receipt_fridge_1_\.pdf$/);
  assert.equal(att.attach(data, files, join(dir, "receipt fridge (1).pdf"), "2026-11-12", { item: "fridge-id" }), a);
  att.attach(data, files, join(dir, "receipt fridge (1).pdf"), "2026-11-12", { bill: "x" });     // same file, another link
  assert.equal(readdirSync(files).length, 1);
  assert.deepEqual(att.verify(data, files), []);
  writeFileSync(att.pathOf(files, a), "tampered");
  assert.equal(att.verify(data, files)[0]!.problem, "changed");
  att.detach(data, files, a);
  assert.ok(existsSync(att.pathOf(files, a)));                 // still used by the bill's link
  att.detach(data, files, data.attachments[0]!);
  assert.ok(!existsSync(att.pathOf(files, a)));
  assert.equal(att.safeName("../../etc/passwd"), "passwd");
  assert.equal(att.safeName("..."), "file");
  assert.throws(() => att.attach(data, files, join(dir, "nope.pdf"), "2026-11-12"), /can't read/);
});


test("the next due date skips ones already paid", () => {
  const data = emptyData("Home");
  const rent = bills.addBill(data, { name: "Rent", recurrence: parseRecurrence("monthly on the 1st"), start: "2026-12-01",
                                     amount: usd("1450") }, "2026-11-12");
  assert.equal(bills.nextDue(rent, "2026-11-12"), "2026-12-01");
  bills.pay(rent, { paid: "2026-11-12" });                       // paid early
  assert.equal(bills.nextDue(rent, "2026-11-12"), "2027-01-01");
});


test("undo takes back the payment entered last, even if it's for an older due date", () => {
  const data = emptyData("Home");
  const water = bills.addBill(data, { name: "Water", recurrence: parseRecurrence("monthly on the 5th"), start: "2026-10-05",
                                      amount: usd("40") }, "2026-09-01");
  bills.pay(water, { paid: "2026-11-10", due: "2026-11-05" });
  bills.pay(water, { paid: "2026-10-06", due: "2026-10-05" });     // October's, entered afterwards
  assert.equal(bills.undoPayment(water).due, "2026-10-05");
  assert.deepEqual(water.payments.map((p) => p.due), ["2026-11-05"]);
});
