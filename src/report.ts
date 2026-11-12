/**
 * The home inventory for insurance, and CSV exports.
 *
 * After a fire, flood or burglary an insurer asks what was lost, what it was
 * worth, when it was bought and for proof. The inventory lists every current
 * item room by room with its brand, model, serial number, purchase date, price,
 * quantity and value, whether it's under warranty and how many receipts are kept,
 * with totals per room and for the home. It comes as a printable HTML page or a CSV.
 *
 * CSV cells that a spreadsheet would run as a formula (= + - @) are prefixed
 * with an apostrophe.
 */

import type { LocalDate } from "./dates.js";
import { type Data, type Item } from "./model.js";
import { attachmentsOf } from "./attachments.js";
import { current, itemValue } from "./inventory.js";
import { type Money, formatMoney, formatTotals, plainAmount, totals } from "./money.js";
import { VERSION } from "./version.js";

export interface InventoryRow {
  item: Item;
  value?: string;
  receipts: number;
  warranty: string;
}

export interface InventoryRoom {
  location: string;
  rows: InventoryRow[];
  total: string;
}

export interface Inventory {
  title: string;
  date: LocalDate;
  rooms: InventoryRoom[];
  total: string;
  items: number;
  missingPrice: number;
  missingSerial: number;
}

/** Top-level location ("Kitchen" for "Kitchen / Pantry"), so each room is one section. */
function room(item: Item): string {
  return item.location?.split(" / ")[0] ?? "No location";
}

export function inventory(data: Data, today: LocalDate): Inventory {
  const items = current(data).filter((i) => i.minimum === undefined);        // supplies aren't belongings to insure
  const byRoom = new Map<string, Item[]>();
  for (const item of items) byRoom.set(room(item), [...(byRoom.get(room(item)) ?? []), item]);
  const rooms = [...byRoom].sort(([a], [b]) => (a === "No location" ? 1 : b === "No location" ? -1 : a.localeCompare(b)))
    .map(([location, list]) => ({
      location,
      total: formatTotals(totals(list.map(itemValue))),
      rows: list.sort((a, b) => (a.location ?? "").localeCompare(b.location ?? "") || a.name.localeCompare(b.name)).map((item) => {
        const value = itemValue(item);
        const row: InventoryRow = {
          item, receipts: attachmentsOf(data, { item: item.id }).length,
          warranty: item.warrantyUntil ? (item.warrantyUntil >= today ? `until ${item.warrantyUntil}` : "ended") : "",
        };
        if (value) row.value = formatMoney(value);
        return row;
      }),
    }));
  return {
    title: `Home inventory: ${data.home}`, date: today, rooms, items: items.length,
    total: formatTotals(totals(items.map(itemValue))),
    missingPrice: items.filter((i) => !i.price).length,
    missingSerial: items.filter((i) => !i.serial && (i.price?.cents ?? 0) >= 10000).length,
  };
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function inventoryHtml(inv: Inventory): string {
  const e = escapeHtml;
  const head = ["Item", "Where", "Brand / model", "Serial", "Bought", "Price", "Qty", "Value", "Warranty", "Receipts"];
  const sections = inv.rooms.map((r) => `<section><h2>${e(r.location)} <span class="total">${e(r.total)}</span></h2>
<table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>
${r.rows.map(({ item, value, receipts, warranty }) => `<tr><td>${e(item.name)}${item.notes ? `<div class="note">${e(item.notes)}</div>` : ""}</td>` +
  `<td>${e(item.location?.split(" / ").slice(1).join(" / ") ?? "")}</td><td>${e([item.brand, item.model].filter(Boolean).join(" "))}</td>` +
  `<td>${e(item.serial ?? "")}</td><td>${e(item.purchased ?? "")}${item.store ? `<div class="note">${e(item.store)}</div>` : ""}</td>` +
  `<td class="n">${item.price ? e(formatMoney(item.price)) : ""}</td><td class="n">${item.quantity}</td><td class="n">${e(value ?? "")}</td>` +
  `<td>${e(warranty)}</td><td class="n">${receipts || ""}</td></tr>`).join("\n")}
</tbody></table></section>`).join("\n");
  const gaps = [inv.missingPrice ? `${inv.missingPrice} item(s) have no price` : "",
                inv.missingSerial ? `${inv.missingSerial} item(s) worth 100 or more have no serial number` : ""].filter(Boolean);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(inv.title)}</title>
<style>
  body { font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1a1a1a; max-width: 75rem; margin: 2rem auto; padding: 0 1rem; }
  h1 { font-size: 1.5rem; margin-bottom: .2rem; } .sub { color: #555; margin-top: 0; }
  h2 { font-size: 1.1rem; margin: 1.5rem 0 .4rem; border-bottom: 1px solid #ccc; } h2 .total { float: right; font-weight: normal; }
  table { border-collapse: collapse; width: 100%; } th, td { text-align: left; padding: .25rem .4rem; border-bottom: 1px solid #e5e5e5; vertical-align: top; }
  th { background: #f3f3f3; font-weight: 600; } td.n { text-align: right; white-space: nowrap; } .note { color: #666; font-size: .9em; }
  section { break-inside: avoid; } .gaps { background: #fff7e0; padding: .5rem .8rem; border-left: 3px solid #e0a800; }
  @media print { body { margin: 0; font-size: 10pt; } th { background: none; } }
</style></head>
<body><h1>${e(inv.title)}</h1>
<p class="sub">${inv.items} items, total value ${e(inv.total)}. Prepared ${e(inv.date)} with hearth ${VERSION}. Values are purchase prices, not replacement costs.</p>
${gaps.length ? `<p class="gaps">To make a claim easier: ${e(gaps.join("; "))}.</p>` : ""}
${sections}
</body></html>
`;
}

export function csvCell(value: string | number): string {
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csv(headers: string[], rows: (string | number)[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

const amount = (m: Money | undefined) => (m ? plainAmount(m) : "");

export function inventoryCsv(data: Data): string {
  return csv(["name", "location", "category", "brand", "model", "serial", "purchased", "store", "price", "currency", "quantity",
              "unit", "warranty_until", "receipts", "tags", "notes"],
    current(data).sort((a, b) => (a.location ?? "").localeCompare(b.location ?? "") || a.name.localeCompare(b.name)).map((i) => [
      i.name, i.location ?? "", i.category ?? "", i.brand ?? "", i.model ?? "", i.serial ?? "", i.purchased ?? "", i.store ?? "",
      amount(i.price), i.price?.currency ?? "", i.quantity, i.unit ?? "", i.warrantyUntil ?? "",
      attachmentsOf(data, { item: i.id }).length, i.tags.join(";"), i.notes ?? "",
    ]));
}

export function paymentsCsv(data: Data): string {
  const rows = data.bills.flatMap((b) => b.payments.map((p) => ({ b, p })))
    .sort((x, y) => x.p.paid.localeCompare(y.p.paid));
  return csv(["paid", "due", "bill", "payee", "amount", "currency", "note"],
    rows.map(({ b, p }) => [p.paid, p.due, b.name, b.payee ?? "", amount(p.amount), p.amount.currency, p.note ?? ""]));
}

export function tasksCsv(data: Data): string {
  const rows = data.tasks.flatMap((t) => t.history.map((c) => ({ t, c }))).sort((x, y) => x.c.date.localeCompare(y.c.date));
  return csv(["date", "task", "status", "by", "cost", "currency", "note"],
    rows.map(({ t, c }) => [c.date, t.name, c.skipped ? "skipped" : "done", data.members.find((m) => m.id === c.by)?.name ?? "",
                            amount(c.cost), c.cost?.currency ?? "", c.note ?? ""]));
}
