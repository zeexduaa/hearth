/**
 * Belongings and supplies.
 *
 * Every item has a location written as a path ("Garage / Shelf 2"), so you can
 * ask what's in the garage, or where the drill is. Items can carry what they
 * cost, when and where they were bought, the serial number and the warranty end
 * date, which is what an insurer asks for after a fire or a burglary.
 *
 * A *supply* is an item with a minimum quantity (toilet paper: 6 rolls). Using
 * some lowers the quantity, and anything below its minimum goes on the
 * shopping list, with enough to get back to its restock level.
 */

import { type LocalDate, addDays, compare, daysBetween } from "./dates.js";
import { type Data, type Item, DataError, cleanLocation, cleanTags, newId, pick } from "./model.js";
import { type Money, totals } from "./money.js";

export interface ItemInput {
  name: string;
  location?: string;
  category?: string;
  quantity?: number;
  unit?: string;
  price?: Money;
  purchased?: LocalDate;
  store?: string;
  brand?: string;
  model?: string;
  serial?: string;
  warrantyUntil?: LocalDate;
  minimum?: number;
  restockTo?: number;
  notes?: string;
  tags?: string[];
}

function checkQuantity(n: number, what = "the quantity"): void {
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000 || Math.round(n * 100) !== n * 100) {
    throw new DataError(`${what} must be a number from 0 to 1000000, with at most two decimals`);
  }
}

export function current(data: Data): Item[] {
  return data.items.filter((i) => !i.disposed);
}

export function findItem(data: Data, query: string, includeDisposed = false): Item {
  return pick(includeDisposed ? data.items : current(data), query, "item", (i) => (i.location ? `in ${i.location}` : undefined));
}

export function addItem(data: Data, input: ItemInput, today: LocalDate): Item {
  const name = input.name.trim();
  if (!name || name.length > 120) throw new DataError("give the item a name (up to 120 characters)");
  const item: Item = { id: newId(), name, quantity: 1, tags: [], created: today };
  applyChanges(item, input);
  data.items.push(item);
  return item;
}

export function applyChanges(item: Item, input: Partial<ItemInput>): void {
  if (input.name !== undefined) {
    if (!input.name.trim()) throw new DataError("the name can't be empty");
    item.name = input.name.trim();
  }
  const text = (key: "location" | "category" | "unit" | "store" | "brand" | "model" | "serial" | "notes") => {
    const v = input[key];
    if (v === undefined) return;
    const clean = key === "location" ? cleanLocation(v) : v.trim();
    if (clean) item[key] = clean; else delete item[key];
  };
  for (const key of ["location", "category", "unit", "store", "brand", "model", "serial", "notes"] as const) text(key);
  if (input.quantity !== undefined) {
    checkQuantity(input.quantity);
    item.quantity = input.quantity;
  }
  if (input.price !== undefined) {
    if (input.price.cents < 0) throw new DataError("a price can't be negative");
    item.price = input.price;
  }
  if (input.purchased !== undefined) item.purchased = input.purchased;
  if (input.warrantyUntil !== undefined) item.warrantyUntil = input.warrantyUntil;
  if (input.minimum !== undefined) {
    checkQuantity(input.minimum, "the minimum");
    if (input.minimum === 0) delete item.minimum; else item.minimum = input.minimum;
  }
  if (input.restockTo !== undefined) {
    checkQuantity(input.restockTo, "the restock level");
    item.restockTo = input.restockTo;
  }
  if (item.minimum !== undefined && item.restockTo !== undefined && item.restockTo < item.minimum) {
    throw new DataError(`the restock level (${item.restockTo}) is below the minimum (${item.minimum})`);
  }
  if (input.tags !== undefined) item.tags = cleanTags(input.tags);
  if (item.purchased && item.warrantyUntil && compare(item.warrantyUntil, item.purchased) < 0) {
    throw new DataError(`the warranty end (${item.warrantyUntil}) is before the purchase date (${item.purchased})`);
  }
}

/** Uses up some of a supply (negative to put some back). */
export function use(item: Item, amount: number): void {
  checkQuantity(Math.abs(amount), "the amount");
  if (amount > item.quantity) {
    throw new DataError(`there ${item.quantity === 1 ? "is" : "are"} only ${item.quantity} ${item.unit ?? ""}`.trimEnd() +
                        ` of ${item.name} on record; set the real count with: hearth count "${item.name}" N`);
  }
  item.quantity = Math.round((item.quantity - amount) * 100) / 100;
}

export function restock(item: Item, amount: number): void {
  if (!(amount > 0)) throw new DataError("the amount bought must be more than 0");
  checkQuantity(item.quantity + amount);
  item.quantity = Math.round((item.quantity + amount) * 100) / 100;
}

export function dispose(item: Item, date: LocalDate, reason?: string): void {
  item.disposed = reason ? { date, reason } : { date };
}

// -- finding ---------------------------------------------------------------------------------------------

/** Matches name, location, category, brand, model, serial, store, tags and notes; all words must match. */
export function search(data: Data, query: string): Item[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return current(data).filter((item) => {
    const hay = [item.name, item.location, item.category, item.brand, item.model, item.serial, item.store, item.notes,
                 ...item.tags].filter(Boolean).join(" ").toLowerCase();
    return words.every((w) => hay.includes(w));
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/** Items in a location and everything under it ("Kitchen" includes "Kitchen / Pantry"). */
export function inLocation(data: Data, location: string): Item[] {
  const want = cleanLocation(location).toLowerCase();
  return current(data).filter((i) => {
    const loc = (i.location ?? "").toLowerCase();
    return loc === want || loc.startsWith(want + " / ");
  }).sort((a, b) => (a.location ?? "").localeCompare(b.location ?? "") || a.name.localeCompare(b.name));
}

export interface LocationSummary {
  location: string;          // "" for items with no location
  items: number;
  value: Money[];
}

/** Each location with its item count and total value (including everything under it). */
export function locations(data: Data): LocationSummary[] {
  const map = new Map<string, Item[]>();
  for (const item of current(data)) {
    const parts = (item.location ?? "").split(" / ").filter(Boolean);
    const paths = parts.length ? parts.map((_, i) => parts.slice(0, i + 1).join(" / ")) : [""];
    for (const path of paths) map.set(path, [...(map.get(path) ?? []), item]);
  }
  return [...map].sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)))
    .map(([location, items]) => ({ location, items: items.length, value: totals(items.map(itemValue)) }));
}

/** Price times quantity, if the price is known. */
export function itemValue(item: Item): Money | undefined {
  return item.price ? { currency: item.price.currency, cents: Math.round(item.price.cents * item.quantity) } : undefined;
}

// -- warranties and supplies --------------------------------------------------------------------------------

export interface WarrantyStatus {
  item: Item;
  until: LocalDate;
  daysLeft: number;          // negative: ended that many days ago
}

/** Warranties ending within ``days`` (and those ended in the last ``recentDays``), soonest first. */
export function warranties(data: Data, today: LocalDate, days: number, recentDays = 0): WarrantyStatus[] {
  return current(data).filter((i) => i.warrantyUntil)
    .map((item) => ({ item, until: item.warrantyUntil!, daysLeft: daysBetween(today, item.warrantyUntil!) }))
    .filter((w) => w.daysLeft <= days && w.daysLeft >= -recentDays)
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

export function underWarranty(data: Data, today: LocalDate): WarrantyStatus[] {
  return warranties(data, today, 100 * 365).filter((w) => w.daysLeft >= 0);
}

export interface ShoppingLine {
  item: Item;
  have: number;
  buy: number;
}

export function shoppingList(data: Data): ShoppingLine[] {
  return current(data).filter((i) => i.minimum !== undefined && i.quantity < i.minimum)
    .map((item) => {
      const target = item.restockTo ?? item.minimum! * 2;
      return { item, have: item.quantity, buy: Math.max(0, Math.ceil(target - item.quantity)) };
    })
    .sort((a, b) => (a.item.location ?? "").localeCompare(b.item.location ?? "") || a.item.name.localeCompare(b.item.name));
}

/** The warranty end from a purchase date and a length like "2 years" or "18 months". */
export function warrantyEnd(purchased: LocalDate, length: string): LocalDate {
  const m = /^\s*(\d+)\s*(day|week|month|year)s?\s*$/i.exec(length);
  if (!m) throw new DataError(`"${length}" isn't a warranty length; use something like "2 years" or "18 months"`);
  const n = Number(m[1]);
  const unit = m[2]!.toLowerCase();
  if (unit === "day") return addDays(purchased, n - 1);
  if (unit === "week") return addDays(purchased, 7 * n - 1);
  const [y, mo, d] = purchased.split("-").map(Number);
  const months = unit === "year" ? 12 * n : n;
  const index = y! * 12 + (mo! - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(Math.min(d!, last)).padStart(2, "0")}`;
  // A 1-year warranty bought on 2026-03-15 covers up to 2027-03-14. When the month is too short for
  // the day (1 month from 31 January), the whole short month is covered: up to 28 February.
  return d! > last ? end : addDays(end, -1);
}
