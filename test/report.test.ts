import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as report from "../src/report.js";
import * as dashboard from "../src/dashboard.js";
import * as inv from "../src/inventory.js";
import * as bills from "../src/bills.js";
import * as tasks from "../src/tasks.js";
import { attach } from "../src/attachments.js";
import { parseRecurrence } from "../src/dates.js";
import { emptyData } from "../src/model.js";
import { parseMoney, plainAmount } from "../src/money.js";

const TODAY = "2026-11-12";
const usd = (t: string) => parseMoney(t, "USD");

function home() {
  const data = emptyData("12 Oak Road");
  const tv = inv.addItem(data, { name: "Television", location: "Living room", brand: "LG", model: "OLED55", serial: "LG-998",
                                 price: usd("1,299"), purchased: "2025-11-28", store: "Best Buy", warrantyUntil: "2027-11-27" }, TODAY);
  inv.addItem(data, { name: "Sofa", location: "Living room", price: usd("850"), notes: "grey, 3-seater <b>" }, TODAY);
  inv.addItem(data, { name: "Laptop", location: "Study / Desk", brand: "Dell", price: usd("999.50"), purchased: "2023-02-01",
                      warrantyUntil: "2024-01-31" }, TODAY);
  inv.addItem(data, { name: "Chairs", location: "Kitchen", quantity: 4, price: usd("45") }, TODAY);
  inv.addItem(data, { name: "Toilet paper", location: "Bathroom", quantity: 2, minimum: 6 }, TODAY);   // a supply: not insured
  inv.addItem(data, { name: "Old painting" }, TODAY);
  const dir = mkdtempSync(join(tmpdir(), "hearth-r-"));
  writeFileSync(join(dir, "tv.pdf"), "receipt");
  attach(data, join(dir, "files"), join(dir, "tv.pdf"), TODAY, { item: tv.id });
  return data;
}

test("the insurance inventory groups by room with values and gaps", () => {
  const r = report.inventory(home(), TODAY);
  assert.equal(r.items, 5);
  assert.deepEqual(r.rooms.map((x) => [x.location, x.rows.length, x.total]),
    [["Kitchen", 1, "$180.00"], ["Living room", 2, "$2,149.00"], ["Study", 1, "$999.50"], ["No location", 1, "nothing"]]);
  assert.equal(r.total, "$3,328.50");
  const tv = r.rooms[1]!.rows.find((x) => x.item.name === "Television")!;
  assert.deepEqual([tv.receipts, tv.warranty, tv.value], [1, "until 2027-11-27", "$1,299.00"]);
  assert.equal(r.rooms[2]!.rows[0]!.warranty, "ended");
  assert.equal(r.missingPrice, 1);
  assert.equal(r.missingSerial, 2);              // the sofa and the laptop; the chairs are $45 each
});

test("HTML is printable and escaped; CSV defuses formulas and keeps currencies right", () => {
  const data = home();
  const html = report.inventoryHtml(report.inventory(data, TODAY));
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<title>Home inventory: 12 Oak Road<\/title>/);
  assert.ok(html.includes("grey, 3-seater &lt;b&gt;") && !html.includes("3-seater <b>"));
  assert.match(html, /@media print/);
  assert.match(html, /have no serial number/);
  const lines = report.inventoryCsv(data).trim().split("\n");
  assert.equal(lines[0], "name,location,category,brand,model,serial,purchased,store,price,currency,quantity,unit,warranty_until,receipts,tags,notes");
  assert.ok(lines.includes("Television,Living room,,LG,OLED55,LG-998,2025-11-28,Best Buy,1299.00,USD,1,,2027-11-27,1,,"));
  assert.equal(report.csvCell("=cmd|' /C calc'!A0"), `'=cmd|' /C calc'!A0`);
  assert.equal(plainAmount(parseMoney("5000 JPY", "USD")), "5000");
});

test("the dashboard gathers what needs attention", () => {
  const data = home();
  tasks.addTask(data, { name: "Smoke alarms", recurrence: parseRecurrence("monthly on the 1st"), start: "2026-11-01", mode: "fixed" }, "2026-10-01");
  tasks.addTask(data, { name: "Gutters", recurrence: parseRecurrence("yearly"), start: "2026-11-20" }, TODAY);
  const power = bills.addBill(data, { name: "Electricity", recurrence: parseRecurrence("monthly on the 10th"), start: "2026-06-10" }, "2026-06-01");
  for (const [m, a] of [["06", "80"], ["07", "85"], ["08", "75"], ["09", "80"], ["10", "130"]] as const) bills.pay(power, { paid: `2026-${m}-10`, amount: usd(a) });
  inv.findItem(data, "television").warrantyUntil = "2026-12-01";
  const d = dashboard.build(data, TODAY);
  assert.deepEqual(d.overdueTasks.map((t) => t.task.name), ["Smoke alarms"]);
  assert.deepEqual(d.dueTasks.map((t) => t.task.name), ["Gutters"]);
  assert.deepEqual(d.overdueBills.map((b) => b.due), ["2026-11-10"]);
  assert.deepEqual(d.warranties.map((w) => w.item.name), ["Television"]);
  assert.deepEqual(d.shopping.map((s) => [s.item.name, s.buy]), [["Toilet paper", 10]]);
  assert.deepEqual(d.unusualBills.map((u) => u.percent), [63]);
  assert.equal(dashboard.isQuiet(d), false);
  assert.equal(dashboard.isQuiet(dashboard.build(emptyData("x"), TODAY)), true);
});
