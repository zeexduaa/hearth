import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, type Context } from "../src/cli.js";

function terminal(start = "2026-11-12") {
  const dir = mkdtempSync(join(tmpdir(), "hearth-cli-"));
  const file = join(dir, "hearth.json");
  let today = start;
  const out: string[] = [];
  const err: string[] = [];
  const ctx: Context = { today: () => today, out: (l) => out.push(l), err: (l) => err.push(l), env: { HEARTH_FILE: file } };
  return {
    dir, file, out, err,
    on(date: string) { today = date; },
    async run(...argv: string[]) {
      out.length = 0;
      err.length = 0;
      return run(argv, ctx);
    },
    text() { return out.join("\n"); },
  };
}

async function home() {
  const t = terminal();
  assert.equal(await t.run("init", "--home", "12 Oak Road", "--currency", "usd"), 0);
  return t;
}

test("an empty home says how to start", async () => {
  const t = await home();
  await t.run();
  assert.match(t.text(), /^12 Oak Road, 2026-11-12\nnothing here yet/);
  assert.equal(await t.run("item", "frobnicate"), 2);
  assert.match(t.err[0]!, /item needs one of: add, edit, show, gone/);
  assert.equal(await t.run("dance"), 2);
});

test("items, rooms, search and warranties", async () => {
  const t = await home();
  await t.run("item", "add", "Fridge", "--in", "kitchen", "--price", "899", "--bought", "2025-12-20", "--warranty", "1 year",
              "--brand", "Samsung", "--serial", "SN123");
  assert.match(t.text(), /added Fridge \(Kitchen\), under warranty until 2026-12-19/);
  await t.run("item", "add", "Drill", "--in", "garage / shelf 2", "--price", "$129.99", "--tags", "tools");
  await t.run("items");
  assert.match(t.text(), /Fridge\s+Kitchen\s+\$899\.00/);
  assert.match(t.text(), /2 item\(s\), worth \$1,028\.99 at purchase price/);
  await t.run("where", "drill");
  assert.equal(t.text(), "Drill: Garage / Shelf 2");
  await t.run("items", "tools");
  assert.doesNotMatch(t.text(), /Fridge/);
  await t.run("rooms");
  assert.match(t.text(), /Garage: 1 item\(s\), \$129\.99\n  Shelf 2: 1 item\(s\), \$129\.99/);
  t.on("2026-11-25");
  await t.run("warranties");
  assert.match(t.text(), /Fridge: until 2026-12-19 \(in 24 days\), no receipt kept/);
  await t.run("item", "gone", "drill", "--reason", "lent to Omar, not returned");
  await t.run("items");
  assert.doesNotMatch(t.text(), /Drill/);
  await t.run("item", "show", "drill");
  assert.match(t.text(), /Drill  \(gone 2026-11-25: lent to Omar, not returned\)/);
});

test("supplies and the shopping list", async () => {
  const t = await home();
  await t.run("item", "add", "Toilet paper", "--in", "bathroom", "--qty", "8", "--unit", "rolls", "--min", "6", "--restock", "18");
  await t.run("use", "toilet paper", "3");
  assert.equal(t.text(), "Toilet paper: 5 rolls left (on the shopping list)");
  await t.run("shopping");
  assert.equal(t.text(), "[ ] Toilet paper: 13 rolls  (have 5)");
  await t.run("buy", "toilet paper", "12");
  await t.run("shopping");
  assert.match(t.text(), /nothing to buy/);
  assert.equal(await t.run("use", "toilet paper", "50"), 1);
  assert.match(t.err[0]!, /only 17 rolls of Toilet paper on record/);
});

test("tasks, rotation and the dashboard", async () => {
  const t = await home();
  await t.run("member", "add", "Syed");
  await t.run("member", "add", "Aisha");
  await t.run("task", "add", "Bins out", "--every", "weekly", "--fixed", "--who", "syed,aisha", "--rotate");
  assert.match(t.text(), /first due 2026-11-12, taking turns: Syed, Aisha/);
  await t.run("task", "add", "Furnace filter", "--every", "every 3 months", "--start", "2026-11-01");
  assert.equal(await t.run("task", "add", "Dishes", "--every", "daily", "--rotate", "--who", "syed"), 2);
  await t.run();
  assert.match(t.text(), /Overdue\n  Furnace filter: overdue since 2026-11-01 \(11 days ago\)/);
  assert.match(t.text(), /Bins out: due 2026-11-12 \(today\), Syed's turn/);
  await t.run("done", "bins");
  assert.match(t.text(), /done: Bins out by Syed; next due 2026-11-19 \(in 7 days\), Aisha's turn/);
  await t.run("done", "furnace", "--cost", "24.99", "--note", "MERV 11");
  assert.match(t.text(), /\$24\.99; next due 2027-02-12/);
  await t.run("undo", "furnace");
  assert.match(t.text(), /next due 2026-11-01/);
  await t.run("members");
  assert.match(t.text(), /Syed: 1\n  Aisha: 0/);
  assert.equal(await t.run("done", "bins", "--date", "tomorrow"), 2);
});

test("bills: paying, overdue, unusual amounts and spending", async () => {
  const t = terminal("2026-06-01");
  await t.run("init");
  await t.run("bill", "add", "Electricity", "--every", "monthly on the 20th", "--payee", "City Power");
  for (const [date, amount] of [["2026-06-20", "80"], ["2026-07-20", "85"], ["2026-08-20", "75"], ["2026-09-20", "80"]]) {
    t.on(date!);
    assert.equal(await t.run("paid", "electricity", amount!), 0);
  }
  t.on("2026-10-21");
  await t.run("paid", "electricity", "131.50");
  assert.match(t.text(), /that's 64% above the usual \$80\.00/);
  await t.run("bill", "add", "Rent", "--every", "monthly on the 1st", "--amount", "1,450");
  t.on("2026-11-03");
  await t.run("bills");
  assert.match(t.text(), /OVERDUE Rent \$1,450\.00: overdue since 2026-11-01/);
  assert.match(t.text(), /about \$1,450\.00 a month/);
  await t.run("paid", "rent");
  assert.match(t.text(), /paid Rent: \$1,450\.00 for 2026-11-01\n  next due 2026-12-01/);
  await t.run("spending", "--months", "3");
  assert.match(t.text(), /2026-09  \$80\.00\n2026-10  \$131\.50\n2026-11  \$1,450\.00\ntotal: \$1,661\.50/);
  await t.run("bill", "show", "electricity");
  assert.match(t.text(), /Electricity \(City Power\): monthly on the 20th/);
  assert.match(t.text(), /total paid: \$451\.50 over 5 payment\(s\)/);
  assert.equal(await t.run("paid", "electricity"), 1);
  assert.match(t.err[0]!, /how much was the Electricity bill/);
});

test("receipts, the insurance report and exports", async () => {
  const t = await home();
  await t.run("item", "add", "Television", "--in", "Living room", "--price", "1299", "--serial", "LG-998");
  writeFileSync(join(t.dir, "tv receipt.pdf"), "%PDF receipt");
  await t.run("attach", join(t.dir, "tv receipt.pdf"), "--to", "television", "--note", "Best Buy");
  assert.match(t.text(), /kept a copy of tv receipt\.pdf with Television/);
  await t.run("check");
  assert.match(t.text(), /all 1 attached file\(s\) are there and unchanged/);
  await t.run("report");
  assert.match(t.text(), /Living room  \(\$1,299\.00\)\n  Television \[LG-998\]  \$1,299\.00  1 receipt\(s\)/);
  const html = join(t.dir, "inventory.html");
  await t.run("report", "--html", html);
  assert.match(readFileSync(html, "utf8"), /<title>Home inventory: 12 Oak Road<\/title>/);
  assert.equal(await t.run("report", "--html", html), 2);
  const csv = join(t.dir, "items.csv");
  await t.run("export", "items", csv);
  assert.match(readFileSync(csv, "utf8"), /Television,Living room,,,,LG-998,,,1299\.00,USD,1,,,1,,/);
  assert.ok(existsSync(csv));
});

test("settings", async () => {
  const t = await home();
  await t.run("settings", "currency", "pkr");
  await t.run("item", "add", "Generator", "--price", "85000");
  await t.run("items");
  assert.match(t.text(), /85,000\.00 PKR/);
  assert.equal(await t.run("settings", "lookaheadDays", "0"), 2);
  assert.equal(await t.run("settings", "colour", "blue"), 2);
});
