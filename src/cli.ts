/**
 * The hearth command line. ``run(argv, context)`` does everything, with the date,
 * output and environment passed in, so tests can drive it; main.ts connects it to
 * the real terminal.
 */

import { parseArgs } from "node:util";
import { existsSync, writeFileSync } from "node:fs";
import { VERSION } from "./version.js";
import * as store from "./store.js";
import { type Data, type Item, DataError, cleanTags } from "./model.js";
import { type LocalDate, DateError, compare, describeRecurrence, parseDate, parseRecurrence, relative } from "./dates.js";
import { MoneyError, formatMoney, formatTotals, parseMoney, totals } from "./money.js";
import * as inv from "./inventory.js";
import * as tasks from "./tasks.js";
import * as bills from "./bills.js";
import * as att from "./attachments.js";
import * as dashboard from "./dashboard.js";
import * as report from "./report.js";

export interface Context {
  today(): LocalDate;
  out(line: string): void;
  err(line: string): void;
  env: NodeJS.ProcessEnv;
}

export class UsageError extends Error {
  override name = "UsageError";
}

const HELP = `hearth ${VERSION}: a private home and household manager

  hearth                                   what needs attention (overdue, due soon, warranties, shopping)
  hearth init [--home NAME] [--currency USD]

Belongings and supplies
  hearth item add NAME [--in "Kitchen / Pantry"] [--price 129.99] [--bought DATE] [--store TEXT]
                       [--brand TEXT] [--model TEXT] [--serial TEXT] [--warranty DATE|"2 years"]
                       [--qty N] [--unit rolls] [--min N] [--restock N] [--category TEXT] [--tags a,b] [--notes TEXT]
  hearth item edit NAME [same options] [--name NEW]
  hearth item show NAME                    details, receipts and upkeep
  hearth item gone NAME [--reason sold]    no longer owned (kept on record)
  hearth items [WORDS] [--in ROOM]         list or search everything
  hearth where NAME                        where something is
  hearth rooms                             each location with item counts and values
  hearth use NAME [N] / hearth buy NAME N / hearth count NAME N
  hearth shopping                          supplies below their minimum
  hearth warranties [--all]                ending soon (or every one still running)

Upkeep and chores
  hearth task add NAME --every "every 3 months" [--fixed] [--start DATE] [--for ITEM] [--who A,B] [--rotate]
  hearth tasks                             everything, with next due dates and turns
  hearth done TASK [--date DATE] [--by NAME] [--cost 24.99] [--note TEXT]
  hearth skip TASK / hearth undo TASK
  hearth task pause|resume|rm TASK
  hearth member add NAME / hearth members  the household, and who did what this month

Bills
  hearth bill add NAME --every "monthly on the 1st" [--amount 1450] [--start DATE] [--until DATE]
                       [--payee TEXT] [--autopay]
  hearth bills                             unpaid and coming due, and a monthly estimate
  hearth paid BILL [AMOUNT] [--date DATE] [--due DATE] [--note TEXT]
  hearth bill show|rm BILL / hearth bill undo BILL
  hearth spending [--months 12]            what bills came to, month by month

Receipts, reports and data
  hearth attach FILE (--to ITEM | --bill BILL) [--note TEXT]
  hearth check                             verify attached files are all there and unchanged
  hearth report [--html FILE | --csv FILE] home inventory for insurance
  hearth export items|payments|tasks FILE.csv
  hearth settings [NAME VALUE]             currency, warrantyWarnDays, lookaheadDays
  --file PATH                              another data file (default: $HEARTH_FILE or your data folder)

Dates: YYYY-MM-DD, today, tomorrow, yesterday, "in 3 days". Repeats: weekly, monthly, quarterly,
yearly, "every 2 weeks", "monthly on the 15th", "monthly on the last day", "monthly on the 2nd tuesday",
"yearly in october".`;

const ITEM_OPTIONS = {
  in: { type: "string" }, price: { type: "string" }, bought: { type: "string" }, store: { type: "string" },
  brand: { type: "string" }, model: { type: "string" }, serial: { type: "string" }, warranty: { type: "string" },
  qty: { type: "string" }, unit: { type: "string" }, min: { type: "string" }, restock: { type: "string" },
  category: { type: "string" }, tags: { type: "string" }, notes: { type: "string" }, name: { type: "string" },
} as const;

interface Session {
  ctx: Context;
  path: string;
  data: Data;
  today: LocalDate;
  dirty: boolean;
}

function opts<T extends Record<string, { type: "string" | "boolean"; short?: string }>>(args: string[], options: T) {
  return parseArgs({ args, options, allowPositionals: true, strict: true });
}

function num(text: string | undefined, what: string): number | undefined {
  if (text === undefined) return undefined;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) throw new UsageError(`${what} must be a number, not "${text}"`);
  return n;
}

function table(rows: string[][]): string[] {
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length)));
  return rows.map((r) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]!))).join("  ").trimEnd());
}

function itemInput(s: Session, values: Record<string, string | boolean | undefined>, existing?: Item): inv.ItemInput & { name: string } {
  const v = values as Record<string, string | undefined>;
  const input: Partial<inv.ItemInput> = {};
  if (v.in !== undefined) input.location = v.in;
  for (const key of ["store", "brand", "model", "serial", "unit", "category", "notes"] as const) if (v[key] !== undefined) input[key] = v[key];
  if (v.price !== undefined) input.price = parseMoney(v.price, s.data.settings.currency);
  if (v.bought !== undefined) input.purchased = parseDate(v.bought, s.today);
  if (v.warranty !== undefined) {
    const bought = input.purchased ?? existing?.purchased;
    input.warrantyUntil = /^\s*\d+\s*(day|week|month|year)s?\s*$/i.test(v.warranty)
      ? inv.warrantyEnd(bought ?? s.today, v.warranty) : parseDate(v.warranty, s.today);
  }
  if (v.qty !== undefined) input.quantity = num(v.qty, "--qty")!;
  if (v.min !== undefined) input.minimum = num(v.min, "--min")!;
  if (v.restock !== undefined) input.restockTo = num(v.restock, "--restock")!;
  if (v.tags !== undefined) input.tags = cleanTags(v.tags.split(","));
  if (v.name !== undefined) input.name = v.name;
  return input as inv.ItemInput & { name: string };
}

/**
 * Splits "council tax 2026 180" into a name and a trailing number, but only when the whole
 * text isn't itself a name: "paid council tax 2026" pays the bill called "Council tax 2026"
 * (rather than paying "Council tax" 2,026), and "use iPhone 15" uses one "iPhone 15".
 */
function splitTrailing(words: string[], names: string[], looksLikeNumber: (w: string) => boolean): { name: string; number?: string } {
  const whole = words.join(" ");
  const last = words.at(-1);
  if (words.length < 2 || !last || !looksLikeNumber(last) || names.some((n) => n.toLowerCase() === whole.trim().toLowerCase())) {
    return { name: whole };
  }
  return { name: words.slice(0, -1).join(" "), number: last };
}

const isQuantity = (w: string) => /^\d+(\.\d+)?$/.test(w);

function itemLine(item: Item): string[] {
  const qty = item.minimum !== undefined || item.quantity !== 1 ? `${item.quantity}${item.unit ? " " + item.unit : ""}` : "";
  return [item.name, item.location ?? "", qty, item.price ? formatMoney(item.price) : ""];
}

function who(s: Session, id: string | undefined): string {
  return tasks.memberName(s.data, id) ?? "";
}

function dueText(daysLeft: number, due: LocalDate, today: LocalDate): string {
  return daysLeft < 0 ? `overdue since ${due} (${relative(due, today)})` : `due ${due} (${relative(due, today)})`;
}

// -- commands ------------------------------------------------------------------------------------------------

type Handler = (s: Session, args: string[]) => number;

const item: Record<string, Handler> = {
  add(s, args) {
    const { values, positionals } = opts(args, ITEM_OPTIONS);
    const input = itemInput(s, values);
    input.name = positionals.join(" ");
    const added = inv.addItem(s.data, input, s.today);
    s.dirty = true;
    s.ctx.out(`added ${added.name}${added.location ? ` (${added.location})` : ""}` +
              (added.warrantyUntil ? `, under warranty until ${added.warrantyUntil}` : "") +
              (added.minimum !== undefined ? `, restock below ${added.minimum}` : ""));
    return 0;
  },
  edit(s, args) {
    const { values, positionals } = opts(args, ITEM_OPTIONS);
    const target = inv.findItem(s.data, positionals.join(" "));
    inv.applyChanges(target, itemInput(s, values, target));
    s.dirty = true;
    s.ctx.out(`updated ${target.name}`);
    return 0;
  },
  show(s, args) {
    const target = inv.findItem(s.data, opts(args, {}).positionals.join(" "), true);
    const line = (label: string, value: string | undefined) => value && s.ctx.out(`  ${(label + ":").padEnd(11)}${value}`);
    s.ctx.out(target.name + (target.disposed ? `  (gone ${target.disposed.date}${target.disposed.reason ? `: ${target.disposed.reason}` : ""})` : ""));
    line("where", target.location);
    line("category", target.category);
    line("make", [target.brand, target.model].filter(Boolean).join(" "));
    line("serial", target.serial);
    line("quantity", target.quantity !== 1 || target.unit ? `${target.quantity}${target.unit ? " " + target.unit : ""}` : undefined);
    line("restock", target.minimum !== undefined ? `below ${target.minimum}, up to ${target.restockTo ?? target.minimum * 2}` : undefined);
    line("bought", [target.purchased, target.store].filter(Boolean).join(", "));
    line("price", target.price && formatMoney(target.price));
    if (target.warrantyUntil) {
      line("warranty", compare(target.warrantyUntil, s.today) >= 0 ? `until ${target.warrantyUntil} (${relative(target.warrantyUntil, s.today)})`
        : `ended ${target.warrantyUntil}`);
    }
    line("tags", target.tags.join(", "));
    line("notes", target.notes);
    for (const a of att.attachmentsOf(s.data, { item: target.id })) {
      line("file", `${a.name}${a.note ? ` (${a.note})` : ""}: ${att.pathOf(store.filesDir(s.path), a)}`);
    }
    for (const t of s.data.tasks.filter((t) => t.item === target.id)) {
      line("upkeep", `${t.name}, ${describeRecurrence(t.recurrence)}, next ${tasks.nextDue(t)}`);
    }
    return 0;
  },
  gone(s, args) {
    const { values, positionals } = opts(args, { reason: { type: "string" } });
    const target = inv.findItem(s.data, positionals.join(" "));
    inv.dispose(target, s.today, values.reason);
    s.dirty = true;
    s.ctx.out(`${target.name} is marked as gone; it stays on record (hearth item show "${target.name}")`);
    return 0;
  },
};

const task: Record<string, Handler> = {
  add(s, args) {
    const { values, positionals } = opts(args, { every: { type: "string" }, fixed: { type: "boolean" }, start: { type: "string" },
                                                 for: { type: "string" }, who: { type: "string" }, rotate: { type: "boolean" },
                                                 notes: { type: "string" } });
    if (!values.every) throw new UsageError('say how often: --every "every 3 months" (or weekly, monthly, "yearly in october"...)');
    const input: tasks.TaskInput = { name: positionals.join(" "), recurrence: parseRecurrence(values.every),
      mode: values.fixed ? "fixed" : "after-done", start: values.start ? parseDate(values.start, s.today) : s.today,
      rotate: !!values.rotate };
    if (values.for) input.item = inv.findItem(s.data, values.for).id;
    if (values.who) input.assignees = values.who.split(",").map((n) => tasks.findMember(s.data, n).id);
    if (values.rotate && (input.assignees?.length ?? 0) < 2) throw new UsageError("--rotate needs at least two people in --who");
    if (values.notes) input.notes = values.notes;
    const added = tasks.addTask(s.data, input, s.today);
    s.dirty = true;
    s.ctx.out(`added ${added.name}: ${describeRecurrence(added.recurrence)}${added.mode === "fixed" ? " (on the calendar)" : " (after each time it's done)"}, ` +
              `first due ${tasks.nextDue(added)}${added.assignees.length ? `, ${added.rotate ? "taking turns: " : "for "}` +
              added.assignees.map((id) => who(s, id)).join(", ") : ""}`);
    return 0;
  },
  pause(s, args) {
    const t = tasks.findTask(s.data, opts(args, {}).positionals.join(" "));
    t.paused = true;
    s.dirty = true;
    s.ctx.out(`paused ${t.name}`);
    return 0;
  },
  resume(s, args) {
    const t = tasks.findTask(s.data, opts(args, {}).positionals.join(" "));
    delete t.paused;
    s.dirty = true;
    s.ctx.out(`resumed ${t.name}; next due ${tasks.nextDue(t)}`);
    return 0;
  },
  rm(s, args) {
    const t = tasks.findTask(s.data, opts(args, {}).positionals.join(" "));
    s.data.tasks.splice(s.data.tasks.indexOf(t), 1);
    s.dirty = true;
    s.ctx.out(`removed ${t.name} and its history`);
    return 0;
  },
};

const bill: Record<string, Handler> = {
  add(s, args) {
    const { values, positionals } = opts(args, { every: { type: "string" }, amount: { type: "string" }, start: { type: "string" },
                                                 until: { type: "string" }, payee: { type: "string" }, autopay: { type: "boolean" },
                                                 notes: { type: "string" } });
    if (!values.every) throw new UsageError('say when it\'s due: --every "monthly on the 1st"');
    const recurrence = parseRecurrence(values.every);
    const input: bills.BillInput = { name: positionals.join(" "), recurrence, start: values.start ? parseDate(values.start, s.today) : s.today,
                                     autopay: !!values.autopay };
    if (values.amount) input.amount = parseMoney(values.amount, s.data.settings.currency);
    if (values.until) input.end = parseDate(values.until, s.today);
    if (values.payee) input.payee = values.payee;
    if (values.notes) input.notes = values.notes;
    const added = bills.addBill(s.data, input, s.today);
    s.dirty = true;
    const next = bills.nextDue(added, s.today);
    s.ctx.out(`added ${added.name}: ${describeRecurrence(recurrence)}${added.amount ? `, ${formatMoney(added.amount)}` : ""}` +
              `${added.autopay ? ", autopay" : ""}${next ? `; next due ${next}` : ""}`);
    return 0;
  },
  show(s, args) {
    const b = bills.findBill(s.data, opts(args, {}).positionals.join(" "));
    s.ctx.out(`${b.name}${b.payee ? ` (${b.payee})` : ""}: ${describeRecurrence(b.recurrence)}` +
              `${b.amount ? `, usually ${formatMoney(b.amount)}` : ""}${b.autopay ? ", autopay" : ""}${b.end ? `, until ${b.end}` : ""}`);
    const next = bills.nextDue(b, s.today);
    if (next) s.ctx.out(`  next due ${next} (${relative(next, s.today)})`);
    for (const p of [...b.payments].sort((x, y) => compare(y.due, x.due)).slice(0, 12)) {
      s.ctx.out(`  ${p.paid}  ${formatMoney(p.amount).padStart(12)}  for ${p.due}${p.note ? `  (${p.note})` : ""}`);
    }
    if (b.payments.length) s.ctx.out(`  total paid: ${formatTotals(totals(b.payments.map((p) => p.amount)))} over ${b.payments.length} payment(s)`);
    for (const a of att.attachmentsOf(s.data, { bill: b.id })) s.ctx.out(`  file: ${a.name}: ${att.pathOf(store.filesDir(s.path), a)}`);
    return 0;
  },
  undo(s, args) {
    const b = bills.findBill(s.data, opts(args, {}).positionals.join(" "));
    const p = bills.undoPayment(b);
    s.dirty = true;
    s.ctx.out(`removed the payment of ${formatMoney(p.amount)} for ${b.name} due ${p.due}`);
    return 0;
  },
  rm(s, args) {
    const b = bills.findBill(s.data, opts(args, {}).positionals.join(" "));
    s.data.bills.splice(s.data.bills.indexOf(b), 1);
    s.dirty = true;
    s.ctx.out(`removed ${b.name} and its payments`);
    return 0;
  },
};

const commands: Record<string, Handler> = {
  status(s) {
    const d = dashboard.build(s.data, s.today);
    s.ctx.out(`${s.data.home}, ${s.today}`);
    if (dashboard.isQuiet(d)) {
      s.ctx.out(s.data.items.length + s.data.tasks.length + s.data.bills.length === 0
        ? "nothing here yet. Start with: hearth item add, hearth task add or hearth bill add (see: hearth help)"
        : `all clear for the next ${s.data.settings.lookaheadDays} days`);
      return 0;
    }
    const section = (title: string, lines: string[]) => {
      if (!lines.length) return;
      s.ctx.out(`\n${title}`);
      for (const l of lines) s.ctx.out(`  ${l}`);
    };
    const taskLine = (t: tasks.TaskStatus) => `${t.task.name}: ${dueText(t.daysLeft, t.due, s.today)}${t.assignee ? `, ${who(s, t.assignee)}'s turn` : ""}`;
    const billLine = (b: bills.BillStatus) => `${b.bill.name}${b.amount ? ` ${formatMoney(b.amount)}` : ""}: ${dueText(b.daysLeft, b.due, s.today)}` +
      `${b.bill.autopay ? " (autopay)" : ""}`;
    section("Overdue", [...d.overdueBills.map(billLine), ...d.overdueTasks.map(taskLine)]);
    section(`Coming up (next ${s.data.settings.lookaheadDays} days)`, [...d.dueBills, ...d.dueTasks]
      .sort((a, b) => a.daysLeft - b.daysLeft)
      .map((x) => ("bill" in x ? billLine(x) : taskLine(x))));
    section("Warranties", d.warranties.map((w) => `${w.item.name}: ${w.daysLeft >= 0 ? `ends ${w.until} (${relative(w.until, s.today)})` : `ended ${w.until}`}`));
    section("Shopping", d.shopping.map((l) => `${l.item.name}: buy ${l.buy}${l.item.unit ? " " + l.item.unit : ""} (have ${l.have})`));
    section("Bills out of the ordinary", d.unusualBills.map((u) => `${u.bill.name}: ${formatMoney(u.payment.amount)} on ${u.payment.paid}, ` +
      `${Math.abs(u.percent)}% ${u.percent > 0 ? "above" : "below"} the usual ${formatMoney(u.average)}`));
    return 0;
  },

  items(s, args) {
    const { values, positionals } = opts(args, { in: { type: "string" } });
    let list = positionals.length ? inv.search(s.data, positionals.join(" ")) : inv.current(s.data);
    if (values.in) {
      const inRoom = new Set(inv.inLocation(s.data, values.in).map((i) => i.id));
      list = list.filter((i) => inRoom.has(i.id));
    }
    if (!list.length) {
      s.ctx.out(s.data.items.length ? "nothing matches" : 'no items yet; add one with: hearth item add "Cordless drill" --in "Garage"');
      return positionals.length ? 1 : 0;
    }
    list = [...list].sort((a, b) => (a.location ?? "~").localeCompare(b.location ?? "~") || a.name.localeCompare(b.name));
    for (const line of table([["item", "where", "qty", "price"], ...list.map(itemLine)])) s.ctx.out(line);
    s.ctx.out(`\n${list.length} item(s), worth ${formatTotals(totals(list.map(inv.itemValue)))} at purchase price`);
    return 0;
  },

  where(s, args) {
    const found = inv.search(s.data, opts(args, {}).positionals.join(" "));
    if (!found.length) {
      s.ctx.out("nothing matches");
      return 1;
    }
    for (const i of found) s.ctx.out(`${i.name}: ${i.location ?? "no location recorded"}`);
    return 0;
  },

  rooms(s) {
    const list = inv.locations(s.data);
    if (!list.length) s.ctx.out("no items yet");
    for (const l of list) {
      const depth = l.location ? l.location.split(" / ").length - 1 : 0;
      const name = l.location ? l.location.split(" / ").at(-1)! : "(no location)";
      s.ctx.out(`${"  ".repeat(depth)}${name}: ${l.items} item(s)${l.value.length ? `, ${formatTotals(l.value)}` : ""}`);
    }
    return 0;
  },

  use(s, args) {
    const { positionals } = opts(args, {});
    const { name, number } = splitTrailing(positionals, inv.current(s.data).map((i) => i.name), isQuantity);
    const target = inv.findItem(s.data, name);
    inv.use(target, number !== undefined ? Number(number) : 1);
    s.dirty = true;
    const low = target.minimum !== undefined && target.quantity < target.minimum;
    s.ctx.out(`${target.name}: ${target.quantity}${target.unit ? " " + target.unit : ""} left${low ? " (on the shopping list)" : ""}`);
    return 0;
  },

  buy(s, args) {
    const { positionals } = opts(args, {});
    const { name, number } = splitTrailing(positionals, inv.current(s.data).map((i) => i.name), isQuantity);
    const amount = num(number, "the number bought");
    if (amount === undefined) throw new UsageError("usage: hearth buy NAME N");
    const target = inv.findItem(s.data, name);
    inv.restock(target, amount);
    s.dirty = true;
    s.ctx.out(`${target.name}: now ${target.quantity}${target.unit ? " " + target.unit : ""}`);
    return 0;
  },

  count(s, args) {
    const { positionals } = opts(args, {});
    const { name, number } = splitTrailing(positionals, inv.current(s.data).map((i) => i.name), isQuantity);
    const amount = num(number, "the count");
    if (amount === undefined) throw new UsageError("usage: hearth count NAME N");
    const target = inv.findItem(s.data, name);
    inv.applyChanges(target, { quantity: amount });
    s.dirty = true;
    s.ctx.out(`${target.name}: ${target.quantity}${target.unit ? " " + target.unit : ""}`);
    return 0;
  },

  shopping(s) {
    const list = inv.shoppingList(s.data);
    if (!list.length) s.ctx.out("nothing to buy: every supply is at or above its minimum");
    for (const l of list) {
      s.ctx.out(`[ ] ${l.item.name}: ${l.buy}${l.item.unit ? " " + l.item.unit : ""}${l.item.store ? ` (${l.item.store})` : ""}  (have ${l.have})`);
    }
    return 0;
  },

  warranties(s, args) {
    const { values } = opts(args, { all: { type: "boolean" } });
    const list = values.all ? inv.underWarranty(s.data, s.today) : inv.warranties(s.data, s.today, s.data.settings.warrantyWarnDays, 30);
    if (!list.length) {
      s.ctx.out(values.all ? "no warranties recorded" : `no warranties end in the next ${s.data.settings.warrantyWarnDays} days ` +
                "(see every running one with --all)");
    }
    for (const w of list) {
      const receipts = att.attachmentsOf(s.data, { item: w.item.id }).length;
      s.ctx.out(`${w.item.name}: ${w.daysLeft >= 0 ? `until ${w.until} (${relative(w.until, s.today)})` : `ended ${w.until}`}` +
                `${receipts ? `, ${receipts} receipt(s) kept` : ", no receipt kept"}`);
    }
    return 0;
  },

  tasks(s) {
    if (!s.data.tasks.length) {
      s.ctx.out('no tasks yet; add one with: hearth task add "Replace furnace filter" --every "every 3 months"');
      return 0;
    }
    const rows = [...s.data.tasks].map((t) => ({ t, due: tasks.nextDue(t) })).sort((a, b) => compare(a.due, b.due));
    for (const line of table([["task", "how often", "next", "turn", "last done"], ...rows.map(({ t, due }) => {
      const last = [...t.history].reverse().find((c) => !c.skipped);
      return [t.name + (t.paused ? " (paused)" : ""), describeRecurrence(t.recurrence) + (t.mode === "fixed" ? "" : " after done"),
              `${due} (${relative(due, s.today)})`, who(s, tasks.turn(t)), last ? last.date : "never"];
    })])) s.ctx.out(line);
    return 0;
  },

  done(s, args) {
    return finish(s, args, false);
  },

  skip(s, args) {
    return finish(s, args, true);
  },

  undo(s, args) {
    const t = tasks.findTask(s.data, opts(args, {}).positionals.join(" "));
    const c = tasks.undoComplete(t);
    s.dirty = true;
    s.ctx.out(`removed ${t.name} ${c.skipped ? "skipped" : "done"} on ${c.date}; next due ${tasks.nextDue(t)}`);
    return 0;
  },

  members(s) {
    if (!s.data.members.length) {
      s.ctx.out("no household members yet; add them with: hearth member add NAME");
      return 0;
    }
    s.ctx.out("done in the last 30 days:");
    for (const c of tasks.choreCounts(s.data, s.today, 30)) s.ctx.out(`  ${c.member.name}: ${c.done}`);
    return 0;
  },

  bills(s) {
    if (!s.data.bills.length) {
      s.ctx.out('no bills yet; add one with: hearth bill add Rent --every "monthly on the 1st" --amount 1450');
      return 0;
    }
    const open = bills.upcoming(s.data, s.today, s.data.settings.lookaheadDays);
    if (!open.length) s.ctx.out(`nothing due in the next ${s.data.settings.lookaheadDays} days`);
    for (const b of open) {
      s.ctx.out(`${b.daysLeft < 0 ? "OVERDUE " : ""}${b.bill.name}${b.amount ? ` ${formatMoney(b.amount)}` : ""}: ` +
                `${dueText(b.daysLeft, b.due, s.today)}${b.bill.autopay ? " (autopay)" : ""}`);
    }
    s.ctx.out(`\nabout ${formatTotals(bills.monthlyEstimate(s.data, s.today))} a month, from the usual amounts`);
    return 0;
  },

  paid(s, args) {
    const { values, positionals } = opts(args, { date: { type: "string" }, due: { type: "string" }, note: { type: "string" } });
    const { name, number } = splitTrailing(positionals, s.data.bills.map((b) => b.name), (w) => /\d/.test(w));
    const amount = number !== undefined ? parseMoney(number, s.data.settings.currency) : undefined;
    const b = bills.findBill(s.data, name);
    const options: bills.PayOptions = { paid: values.date ? parseDate(values.date, s.today) : s.today };
    if (amount) options.amount = amount;
    if (values.due) options.due = parseDate(values.due, s.today);
    if (values.note) options.note = values.note;
    if (compare(options.paid, s.today) > 0) throw new UsageError("a payment can't be in the future");
    const p = bills.pay(b, options, s.data.settings.lookaheadDays + 31);
    s.dirty = true;
    s.ctx.out(`paid ${b.name}: ${formatMoney(p.amount)} for ${p.due}`);
    const odd = bills.unusual(s.data).find((u) => u.bill === b && u.payment === p);
    if (odd) s.ctx.out(`  that's ${Math.abs(odd.percent)}% ${odd.percent > 0 ? "above" : "below"} the usual ${formatMoney(odd.average)}`);
    const next = bills.nextDue(b, s.today);
    if (next) s.ctx.out(`  next due ${next}`);
    return 0;
  },

  spending(s, args) {
    const { values } = opts(args, { months: { type: "string" } });
    const months = num(values.months, "--months") ?? 12;
    if (!Number.isInteger(months) || months < 1 || months > 120) throw new UsageError("--months must be 1 to 120");
    for (const m of bills.spending(s.data, s.today, months)) s.ctx.out(`${m.month}  ${formatTotals(m.total)}`);
    const all = bills.spending(s.data, s.today, months).flatMap((m) => m.total);
    s.ctx.out(`total: ${formatTotals(totals(all))}`);
    return 0;
  },

  attach(s, args) {
    const { values, positionals } = opts(args, { to: { type: "string" }, bill: { type: "string" }, note: { type: "string" } });
    const file = positionals.join(" ");
    if (!file || (!values.to && !values.bill)) throw new UsageError('usage: hearth attach FILE --to ITEM (or --bill BILL)');
    const link: { item?: string; bill?: string; note?: string } = {};
    let label: string;
    if (values.to) {
      const target = inv.findItem(s.data, values.to);
      link.item = target.id;
      label = target.name;
    } else {
      const b = bills.findBill(s.data, values.bill!);
      link.bill = b.id;
      label = b.name;
    }
    if (values.note) link.note = values.note;
    const a = att.attach(s.data, store.filesDir(s.path), file, s.today, link);
    s.dirty = true;
    s.ctx.out(`kept a copy of ${a.name} with ${label} (${Math.max(1, Math.round(a.size / 1024))} KB); the original can be moved or deleted`);
    return 0;
  },

  check(s) {
    const problems = att.verify(s.data, store.filesDir(s.path));
    for (const p of problems) s.ctx.out(`${p.problem}: ${p.attachment.name} (${p.attachment.file})`);
    s.ctx.out(problems.length ? `${problems.length} attached file(s) need attention` : `all ${s.data.attachments.length} attached file(s) are there and unchanged`);
    return problems.length ? 1 : 0;
  },

  report(s, args) {
    const { values } = opts(args, { html: { type: "string" }, csv: { type: "string" }, force: { type: "boolean" } });
    const target = values.html ?? values.csv;
    if (target && existsSync(target) && !values.force) throw new UsageError(`${target} already exists (add --force to replace it)`);
    const r = report.inventory(s.data, s.today);
    if (values.html) {
      writeFileSync(values.html, report.inventoryHtml(r), { mode: 0o600 });
      s.ctx.out(`wrote ${values.html}: ${r.items} items, ${r.total}. Open it in a browser to read or print it.`);
    } else if (values.csv) {
      writeFileSync(values.csv, report.inventoryCsv(s.data), { mode: 0o600 });
      s.ctx.out(`wrote ${values.csv}`);
    } else {
      s.ctx.out(`${r.title}: ${r.items} items, ${r.total}`);
      for (const room of r.rooms) {
        s.ctx.out(`\n${room.location}  (${room.total})`);
        for (const row of room.rows) {
          s.ctx.out(`  ${row.item.name}${row.item.serial ? ` [${row.item.serial}]` : ""}${row.value ? `  ${row.value}` : ""}` +
                    `${row.receipts ? `  ${row.receipts} receipt(s)` : ""}`);
        }
      }
      if (r.missingPrice || r.missingSerial) {
        s.ctx.out(`\nto make a claim easier: ${[r.missingPrice ? `${r.missingPrice} item(s) have no price` : "",
          r.missingSerial ? `${r.missingSerial} valuable item(s) have no serial number` : ""].filter(Boolean).join("; ")}`);
      }
      s.ctx.out("\nfor a printable copy: hearth report --html inventory.html");
    }
    return 0;
  },

  export(s, args) {
    const { values, positionals } = opts(args, { force: { type: "boolean" } });
    const [what, file] = positionals;
    const makers: Record<string, (d: Data) => string> = { items: report.inventoryCsv, payments: report.paymentsCsv, tasks: report.tasksCsv };
    if (!what || !makers[what] || !file) throw new UsageError("usage: hearth export items|payments|tasks FILE.csv");
    if (existsSync(file) && !values.force) throw new UsageError(`${file} already exists (add --force to replace it)`);
    writeFileSync(file, makers[what]!(s.data), { mode: 0o600 });
    s.ctx.out(`wrote ${file}`);
    return 0;
  },

  settings(s, args) {
    const [name, value] = opts(args, {}).positionals;
    const settings = s.data.settings as unknown as Record<string, string | number>;
    if (!name) {
      for (const [k, v] of Object.entries(settings)) s.ctx.out(`${k} = ${v}`);
      return 0;
    }
    if (!(name in settings)) throw new UsageError(`unknown setting ${name}; there are: ${Object.keys(settings).join(", ")}`);
    if (value === undefined) throw new UsageError(`usage: hearth settings ${name} VALUE`);
    if (name === "currency") {
      if (!/^[A-Za-z]{3}$/.test(value)) throw new UsageError("the currency is a 3-letter code like USD, EUR or PKR");
      settings[name] = value.toUpperCase();
    } else {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 365) throw new UsageError(`${name} is a number of days from 1 to 365`);
      settings[name] = n;
    }
    s.dirty = true;
    s.ctx.out(`${name} = ${settings[name]}`);
    return 0;
  },
};

function finish(s: Session, args: string[], skipped: boolean): number {
  const { values, positionals } = opts(args, { date: { type: "string" }, by: { type: "string" }, cost: { type: "string" },
                                               note: { type: "string" } });
  const t = tasks.findTask(s.data, positionals.join(" "));
  const date = values.date ? parseDate(values.date, s.today) : s.today;
  if (compare(date, s.today) > 0) throw new UsageError("it can't be done in the future");
  const options: tasks.CompleteOptions = { skipped };
  if (values.by) options.by = tasks.findMember(s.data, values.by).id;
  if (values.cost) options.cost = parseMoney(values.cost, s.data.settings.currency);
  if (values.note) options.note = values.note;
  const { completion, next } = tasks.complete(t, date, options);
  s.dirty = true;
  s.ctx.out(`${skipped ? "skipped" : "done"}: ${t.name}${completion.by ? ` by ${who(s, completion.by)}` : ""}` +
            `${completion.cost ? `, ${formatMoney(completion.cost)}` : ""}; next due ${next} (${relative(next, s.today)})` +
            `${t.rotate ? `, ${who(s, tasks.turn(t))}'s turn` : ""}`);
  return 0;
}

const member: Record<string, Handler> = {
  add(s, args) {
    const m = tasks.addMember(s.data, opts(args, {}).positionals.join(" "));
    s.dirty = true;
    s.ctx.out(`added ${m.name} to the household`);
    return 0;
  },
};

const GROUPS: Record<string, Record<string, Handler>> = { item, task, bill, member };

export async function run(argv: string[], ctx: Context): Promise<number> {
  const args = [...argv];
  let file: string | undefined;
  const at = args.indexOf("--file");
  if (at >= 0) {
    file = args[at + 1];
    if (!file) {
      ctx.err("hearth: --file needs a path");
      return 2;
    }
    args.splice(at, 2);
  }
  const path = file ?? store.defaultPath(ctx.env);
  let command = args.shift() ?? "status";
  if (["today", "dashboard"].includes(command)) command = "status";
  try {
    if (command === "help" || command === "--help" || command === "-h") {
      for (const line of HELP.split("\n")) ctx.out(line);
      return 0;
    }
    if (command === "version" || command === "--version" || command === "-v") {
      ctx.out(`hearth ${VERSION}`);
      return 0;
    }
    if (command === "init") {
      const { values } = opts(args, { home: { type: "string" }, currency: { type: "string" }, force: { type: "boolean" } });
      const data = store.create(path, values.home?.trim() || "Home", values.currency, values.force);
      ctx.out(`created ${path} for ${data.home} (amounts in ${data.settings.currency} unless you say otherwise)`);
      ctx.out('next: hearth item add "Fridge" --in Kitchen --price 899 --warranty "2 years", or see: hearth help');
      return 0;
    }
    let handler: Handler | undefined;
    if (GROUPS[command]) {
      const sub = args.shift();
      handler = sub ? GROUPS[command]![sub] : undefined;
      if (!handler) {
        ctx.err(`hearth: ${command} needs one of: ${Object.keys(GROUPS[command]!).join(", ")} (see: hearth help)`);
        return 2;
      }
    } else {
      handler = commands[command];
    }
    if (!handler) {
      ctx.err(`hearth: unknown command "${command}"; see: hearth help`);
      return 2;
    }
    const data = store.load(path);
    const session: Session = { ctx, path, data, today: ctx.today(), dirty: false };
    const code = handler(session, args);
    if (session.dirty) store.save(path, session.data);
    return code;
  } catch (err: any) {
    const parse = typeof err?.code === "string" && err.code.startsWith("ERR_PARSE_ARGS");
    if (err instanceof DataError || err instanceof UsageError || err instanceof DateError || err instanceof MoneyError || parse) {
      ctx.err(`hearth: ${err.message}`);
      return err instanceof UsageError || parse ? 2 : 1;
    }
    throw err;
  }
}
