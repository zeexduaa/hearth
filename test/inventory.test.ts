import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as inv from "../src/inventory.js";
import * as store from "../src/store.js";
import { emptyData } from "../src/model.js";
import { parseMoney } from "../src/money.js";

const TODAY = "2026-11-12";
const usd = (t: string) => parseMoney(t, "USD");

function home() {
  const data = emptyData("Test home");
  inv.addItem(data, { name: "Cordless drill", location: "garage/ shelf 2", brand: "Makita", serial: "MK-123",
                      price: usd("129.99"), purchased: "2025-12-01", warrantyUntil: "2026-11-30", tags: ["Tools", "tools"] }, TODAY);
  inv.addItem(data, { name: "Toilet paper", location: "Bathroom / Cabinet", quantity: 4, unit: "rolls", minimum: 6, restockTo: 18,
                      price: usd("0.75") }, TODAY);
  inv.addItem(data, { name: "Dish soap", location: "Kitchen / Under sink", quantity: 2, unit: "bottles", minimum: 1 }, TODAY);
  inv.addItem(data, { name: "Fridge", location: "Kitchen", price: usd("1,100"), purchased: "2024-06-01", warrantyUntil: "2029-05-31",
                      model: "RF28" }, TODAY);
  return data;
}

test("adding cleans up locations and tags, and checks the dates", () => {
  const data = home();
  const drill = inv.findItem(data, "drill");
  assert.equal(drill.location, "Garage / Shelf 2");
  assert.deepEqual(drill.tags, ["tools"]);
  assert.throws(() => inv.addItem(data, { name: "TV", purchased: "2026-01-01", warrantyUntil: "2025-01-01" }, TODAY), /before the purchase date/);
  assert.throws(() => inv.addItem(data, { name: "Rice", minimum: 5, restockTo: 2 }, TODAY), /below the minimum/);
  assert.throws(() => inv.addItem(data, { name: "  " }, TODAY), /give the item a name/);
});

test("search and locations", () => {
  const data = home();
  assert.deepEqual(inv.search(data, "makita").map((i) => i.name), ["Cordless drill"]);
  assert.deepEqual(inv.search(data, "kitchen").map((i) => i.name), ["Dish soap", "Fridge"]);
  assert.deepEqual(inv.search(data, "mk-123 garage").map((i) => i.name), ["Cordless drill"]);
  assert.deepEqual(inv.inLocation(data, "kitchen").map((i) => i.name), ["Fridge", "Dish soap"]);
  const locs = inv.locations(data);
  assert.deepEqual(locs.map((l) => [l.location, l.items]), [
    ["Bathroom", 1], ["Bathroom / Cabinet", 1], ["Garage", 1], ["Garage / Shelf 2", 1], ["Kitchen", 2], ["Kitchen / Under sink", 1]]);
  assert.deepEqual(locs.find((l) => l.location === "Bathroom")!.value, [{ currency: "USD", cents: 300 }]);   // 4 x 0.75
});

test("supplies and the shopping list", () => {
  const data = home();
  const soap = inv.findItem(data, "dish soap");
  assert.deepEqual(inv.shoppingList(data).map((l) => [l.item.name, l.have, l.buy]), [["Toilet paper", 4, 14]]);
  inv.use(soap, 2);
  assert.deepEqual(inv.shoppingList(data).map((l) => [l.item.name, l.buy]), [["Toilet paper", 14], ["Dish soap", 2]]);
  assert.throws(() => inv.use(soap, 1), /only 0 bottles of Dish soap on record/);
  inv.restock(soap, 3);
  assert.equal(soap.quantity, 3);
});

test("warranties", () => {
  const data = home();
  assert.deepEqual(inv.warranties(data, TODAY, 30).map((w) => [w.item.name, w.daysLeft]), [["Cordless drill", 18]]);
  assert.deepEqual(inv.underWarranty(data, TODAY).map((w) => w.item.name), ["Cordless drill", "Fridge"]);
  assert.deepEqual(inv.warranties(data, "2026-12-05", 30, 30).map((w) => [w.item.name, w.daysLeft]), [["Cordless drill", -5]]);
  assert.equal(inv.warrantyEnd("2026-03-15", "1 year"), "2027-03-14");
  assert.equal(inv.warrantyEnd("2026-01-31", "1 month"), "2026-02-28");
  assert.equal(inv.warrantyEnd("2026-03-15", "90 days"), "2026-06-12");
  assert.throws(() => inv.warrantyEnd("2026-03-15", "forever"), /isn't a warranty length/);
});

test("disposed items drop out but stay on record", () => {
  const data = home();
  inv.dispose(inv.findItem(data, "fridge"), TODAY, "sold");
  assert.throws(() => inv.findItem(data, "fridge"), /no item called "fridge"/);
  assert.equal(inv.findItem(data, "fridge", true).disposed?.reason, "sold");
  assert.equal(inv.search(data, "kitchen").length, 1);
});

test("the store round-trips, keeps a backup and refuses strangers", () => {
  const dir = mkdtempSync(join(tmpdir(), "hearth-"));
  const path = join(dir, "hearth.json");
  const data = store.create(path, "Flat 4", "gbp");
  assert.equal(data.settings.currency, "GBP");
  inv.addItem(data, { name: "Kettle" }, TODAY);
  store.save(path, data);
  assert.equal(store.load(path).items[0]!.name, "Kettle");
  assert.deepEqual(readdirSync(dir).sort(), ["hearth.json", "hearth.json.bak"]);
  if (process.platform !== "win32") assert.equal(statSync(path).mode & 0o077, 0);
  assert.match(readFileSync(`${path}.bak`, "utf8"), /"items": \[\]/);
  assert.throws(() => store.create(path, "x"), /already a data file/);
  assert.throws(() => store.create(join(dir, "y.json"), "x", "dollars"), /3-letter code/);
  writeFileSync(join(dir, "z.json"), JSON.stringify({ format: "hearth", version: 7 }));
  assert.throws(() => store.load(join(dir, "z.json")), /newer hearth/);
  assert.throws(() => store.load(join(dir, "none.json")), /hearth init/);
  assert.equal(store.filesDir(path), join(dir, "hearth-files"));
});
