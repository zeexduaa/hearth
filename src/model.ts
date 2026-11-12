/**
 * What hearth keeps about a home.
 *
 * - items: belongings and supplies, where they are, what they cost, their
 *   warranties and receipts; supplies have a level below which they go on the
 *   shopping list;
 * - tasks: recurring upkeep (replace the furnace filter every 3 months) and
 *   chores, optionally shared out in turn among the household;
 * - bills: recurring payments with their due dates and what was paid;
 * - attachments: copies of receipts, manuals and warranty cards;
 * - members: the people in the household, for chores.
 */

import { randomBytes } from "node:crypto";
import type { LocalDate, Recurrence } from "./dates.js";
import type { Money } from "./money.js";

export const FORMAT = "hearth";
export const VERSION = 1;

export interface Member {
  id: string;
  name: string;
}

export interface Item {
  id: string;
  name: string;
  location?: string;        // "Kitchen / Pantry": a path, most general first
  category?: string;
  quantity: number;
  unit?: string;            // for supplies: rolls, bottles, kg
  price?: Money;            // per unit, as paid
  purchased?: LocalDate;
  store?: string;
  brand?: string;
  model?: string;
  serial?: string;
  warrantyUntil?: LocalDate;
  minimum?: number;         // a supply: put it on the shopping list below this quantity
  restockTo?: number;       // ...and buy enough to get back to this (default: minimum * 2)
  notes?: string;
  tags: string[];
  disposed?: { date: LocalDate; reason?: string };
  created: LocalDate;
}

export interface Completion {
  date: LocalDate;
  by?: string;              // member id
  cost?: Money;
  note?: string;
}

export interface Task {
  id: string;
  name: string;
  item?: string;            // the item it looks after
  recurrence: Recurrence;
  /** fixed: due on the calendar (bins every Tuesday); after-done: due one period after it was last done (filters). */
  mode: "fixed" | "after-done";
  start: LocalDate;         // first due date
  assignees: string[];      // member ids; with rotate, they take turns
  rotate: boolean;
  history: Completion[];
  notes?: string;
  paused?: boolean;
  created: LocalDate;
}

export interface Payment {
  due: LocalDate;           // which due date it pays
  paid: LocalDate;
  amount: Money;
  note?: string;
}

export interface Bill {
  id: string;
  name: string;
  payee?: string;
  recurrence: Recurrence;
  start: LocalDate;         // first due date
  end?: LocalDate;          // no due dates after this (a loan's last payment)
  amount?: Money;           // what's usually due; actual amounts are in payments
  autopay: boolean;
  payments: Payment[];
  notes?: string;
  created: LocalDate;
}

export interface Attachment {
  id: string;
  file: string;             // stored name inside the files folder
  name: string;             // the original file name
  sha256: string;
  size: number;
  added: LocalDate;
  item?: string;
  bill?: string;
  note?: string;
}

export interface Settings {
  currency: string;         // default currency for amounts typed without one
  warrantyWarnDays: number; // warn this many days before a warranty ends
  lookaheadDays: number;    // how far ahead the dashboard looks
}

export interface Data {
  format: typeof FORMAT;
  version: typeof VERSION;
  home: string;             // a name for the household
  settings: Settings;
  members: Member[];
  items: Item[];
  tasks: Task[];
  bills: Bill[];
  attachments: Attachment[];
}

export class DataError extends Error {
  override name = "DataError";
}

export function newId(): string {
  return randomBytes(4).toString("hex");
}

export const DEFAULT_SETTINGS: Settings = { currency: "USD", warrantyWarnDays: 30, lookaheadDays: 14 };

export function emptyData(home: string, currency = DEFAULT_SETTINGS.currency): Data {
  return { format: FORMAT, version: VERSION, home, settings: { ...DEFAULT_SETTINGS, currency: currency.toUpperCase() },
           members: [], items: [], tasks: [], bills: [], attachments: [] };
}

/** Finds by exact name, then id or id prefix, then a unique part of the name. */
export function pick<T extends { id: string; name: string }>(items: T[], query: string, what: string): T {
  const q = query.trim().toLowerCase();
  if (!q) throw new DataError(`which ${what}?`);
  const exact = items.filter((i) => i.name.toLowerCase() === q || i.id === q);
  if (exact.length === 1) return exact[0]!;
  const partial = exact.length ? exact : items.filter((i) => i.name.toLowerCase().includes(q) || (q.length >= 4 && i.id.startsWith(q)));
  if (partial.length === 1) return partial[0]!;
  if (!partial.length) {
    const names = items.slice(0, 12).map((i) => i.name);
    throw new DataError(`no ${what} called "${query}"` + (names.length ? `; there are: ${names.join(", ")}${items.length > 12 ? ", ..." : ""}` : ""));
  }
  throw new DataError(`"${query}" matches ${partial.slice(0, 8).map((i) => i.name).join(", ")}${partial.length > 8 ? ", ..." : ""}; be more specific`);
}

export function cleanTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags.map((t) => t.trim().toLowerCase()).filter(Boolean)) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/** "kitchen/pantry " -> "Kitchen / Pantry". Capitalized for display; compared case-insensitively. */
export function cleanLocation(text: string): string {
  return text.split("/").map((p) => p.trim()).filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" / ");
}
