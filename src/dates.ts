/**
 * Calendar dates and things that repeat.
 *
 * Household things happen on days, not at times, so everything here is a plain
 * calendar date ("2026-03-31"). A *recurrence* says how a date repeats:
 *
 *   daily, weekly, monthly, yearly, every 3 days / 2 weeks / 6 months / 2 years
 *   monthly on the 15th            a fixed day of the month
 *   monthly on the last day        the last day, whatever the month's length
 *   monthly on the 2nd tuesday     the nth weekday ("last friday" works too)
 *   yearly in october              a month of the year (day from the start date)
 *
 * Months are uneven, so a bill due on the 31st falls on 28 or 29 February and is
 * back on the 31st in March. The day is always worked out from the start date,
 * never from the previous occurrence, so it doesn't drift to the 28th forever.
 */

export type LocalDate = string;

export class DateError extends Error {
  override name = "DateError";
}

const DAY_MS = 86_400_000;
export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const;

function toDays(date: LocalDate): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!) / DAY_MS;
}

function fromDays(days: number): LocalDate {
  return new Date(days * DAY_MS).toISOString().slice(0, 10);
}

function parts(date: LocalDate): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number);
  return [y!, m!, d!];
}

function make(year: number, month: number, day: number): LocalDate {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Today's date where the user is (the computer's time zone unless one is given). */
export function today(now = Date.now(), zone?: string): LocalDate {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
  return f.format(new Date(now));
}

/** YYYY-MM-DD, or today / tomorrow / yesterday, or "in 3 days" / "in 2 weeks". */
export function parseDate(text: string, base?: LocalDate): LocalDate {
  const t = text.trim().toLowerCase();
  const ref = base ?? today();
  if (t === "today") return ref;
  if (t === "tomorrow") return addDays(ref, 1);
  if (t === "yesterday") return addDays(ref, -1);
  const rel = /^in (\d+) (day|week|month|year)s?$/.exec(t);
  if (rel) {
    const n = Number(rel[1]);
    return rel[2] === "day" ? addDays(ref, n) : rel[2] === "week" ? addDays(ref, 7 * n)
      : addMonths(ref, rel[2] === "month" ? n : 12 * n);
  }
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (!m) throw new DateError(`"${text}" isn't a date; use YYYY-MM-DD (or today, tomorrow, "in 3 days")`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) throw new DateError(`${text} isn't a real date`);
  return make(y, mo, d);
}

export function addDays(date: LocalDate, n: number): LocalDate {
  return fromDays(toDays(date) + n);
}

/** Adds months, keeping the day if the month has it and using the month's last day if not. */
export function addMonths(date: LocalDate, n: number, day?: number): LocalDate {
  const [y, m, d] = parts(date);
  const index = y * 12 + (m - 1) + n;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return make(year, month, Math.min(day ?? d, daysInMonth(year, month)));
}

export function daysBetween(a: LocalDate, b: LocalDate): number {
  return toDays(b) - toDays(a);
}

export function weekday(date: LocalDate): Weekday {
  return WEEKDAYS[new Date(toDays(date) * DAY_MS).getUTCDay()]!;
}

export function compare(a: LocalDate, b: LocalDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** "in 3 days", "tomorrow", "today", "2 days ago". */
export function relative(date: LocalDate, from: LocalDate): string {
  const n = daysBetween(from, date);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  if (n > 0) return n < 60 ? `in ${n} days` : `in ${Math.round(n / 30)} months`;
  return -n < 60 ? `${-n} days ago` : `${Math.round(-n / 30)} months ago`;
}

// -- recurrence ----------------------------------------------------------------------------------------

export type Unit = "day" | "week" | "month" | "year";

export interface Recurrence {
  every: number;
  unit: Unit;
  /** For month/year units: which day of the month. Default: the start date's day. */
  day?: number | "last";
  /** For month/year units: the nth weekday instead (n = 1..4, or -1 for the last). */
  nth?: { n: number; weekday: Weekday };
  /** For the year unit: which month (1-12). Default: the start date's month. */
  month?: number;
}

export function validateRecurrence(r: Recurrence): Recurrence {
  if (!Number.isInteger(r.every) || r.every < 1 || r.every > 1000) throw new DateError("repeat every 1 to 1000 units");
  if (r.day !== undefined && r.day !== "last" && (!Number.isInteger(r.day) || r.day < 1 || r.day > 31)) {
    throw new DateError("the day of the month must be 1 to 31, or last");
  }
  if (r.nth && (![1, 2, 3, 4, -1].includes(r.nth.n) || !WEEKDAYS.includes(r.nth.weekday))) {
    throw new DateError("use 1st to 4th, or last, with a day of the week");
  }
  if ((r.day !== undefined || r.nth) && r.unit !== "month" && r.unit !== "year") {
    throw new DateError("a day of the month only makes sense for monthly or yearly");
  }
  if (r.month !== undefined && (r.unit !== "year" || !Number.isInteger(r.month) || r.month < 1 || r.month > 12)) {
    throw new DateError("a month of the year only makes sense for yearly");
  }
  return r;
}

function nthWeekday(year: number, month: number, n: number, wd: Weekday): LocalDate {
  const target = WEEKDAYS.indexOf(wd);
  if (n > 0) {
    const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    return make(year, month, 1 + ((target - first + 7) % 7) + (n - 1) * 7);
  }
  const lastDay = daysInMonth(year, month);
  const last = new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay();
  return make(year, month, lastDay - ((last - target + 7) % 7));
}

/** The kth occurrence (k = 0 is the first on or after the start). */
function occurrence(r: Recurrence, start: LocalDate, k: number): LocalDate {
  if (r.unit === "day") return addDays(start, k * r.every);
  if (r.unit === "week") return addDays(start, k * r.every * 7);
  const [sy, sm, sd] = parts(start);
  const firstMonth = r.unit === "year" && r.month ? r.month : sm;
  const index = sy * 12 + (firstMonth - 1) + k * r.every * (r.unit === "year" ? 12 : 1);
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  if (r.nth) return nthWeekday(year, month, r.nth.n, r.nth.weekday);
  const day = r.day === "last" ? daysInMonth(year, month) : Math.min(r.day ?? sd, daysInMonth(year, month));
  return make(year, month, day);
}

function approxPeriod(r: Recurrence): number {
  return r.every * { day: 1, week: 7, month: 30.44, year: 365.25 }[r.unit];
}

/** The first occurrence on or after ``from`` (occurrences start at ``start``). */
export function nextOnOrAfter(r: Recurrence, start: LocalDate, from: LocalDate): LocalDate {
  let k = Math.max(0, Math.floor(daysBetween(start, from) / approxPeriod(r)) - 2);
  // The first occurrence can come before the start (e.g. "monthly on the 1st" starting the 15th): skip it.
  for (;; k++) {
    const d = occurrence(r, start, k);
    if (compare(d, from) >= 0 && compare(d, start) >= 0) return d;
  }
}

/** Every occurrence with ``from <= date <= to``. */
export function between(r: Recurrence, start: LocalDate, from: LocalDate, to: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  for (let d = nextOnOrAfter(r, start, compare(from, start) > 0 ? from : start); compare(d, to) <= 0;
       d = nextOnOrAfter(r, start, addDays(d, 1))) {
    out.push(d);
  }
  return out;
}

/** One period after ``date``, for things due "3 months after it was last done". */
export function after(r: Recurrence, date: LocalDate): LocalDate {
  if (r.unit === "day") return addDays(date, r.every);
  if (r.unit === "week") return addDays(date, 7 * r.every);
  return addMonths(date, r.every * (r.unit === "year" ? 12 : 1));
}

const ORDINAL: Record<string, number> = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4, last: -1 };

export function parseRecurrence(text: string): Recurrence {
  let t = text.trim().toLowerCase().replace(/\s+/g, " ");
  const simple: Record<string, Recurrence> = {
    daily: { every: 1, unit: "day" }, weekly: { every: 1, unit: "week" }, fortnightly: { every: 2, unit: "week" },
    biweekly: { every: 2, unit: "week" }, monthly: { every: 1, unit: "month" }, quarterly: { every: 3, unit: "month" },
    yearly: { every: 1, unit: "year" }, annually: { every: 1, unit: "year" },
  };
  let base: Recurrence | undefined;
  const head = /^(daily|weekly|fortnightly|biweekly|monthly|quarterly|yearly|annually|every (?:(\d+|other) )?(day|week|month|year)s?)\b ?(.*)$/.exec(t);
  if (!head) throw new DateError(`can't read "${text}". Examples: monthly, every 3 months, weekly, ` +
                                 `"monthly on the 15th", "monthly on the last friday", "yearly in october"`);
  if (simple[head[1]!]) base = { ...simple[head[1]!]! };
  else base = { every: head[2] === "other" ? 2 : Number(head[2] ?? 1), unit: head[3] as Unit };
  t = head[4]!.trim();
  if (t) {
    let m = /^on the (\d{1,2})(?:st|nd|rd|th)?$/.exec(t);
    if (m) base.day = Number(m[1]);
    else if ((m = /^on the last day$/.exec(t))) base.day = "last";
    else if ((m = /^on the (first|second|third|fourth|last|1st|2nd|3rd|4th) (mon|tue|wed|thu|fri|sat|sun)[a-z]*$/.exec(t))) {
      base.nth = { n: ORDINAL[m[1]!]!, weekday: m[2] as Weekday };
    } else if ((m = /^in ([a-z]+)$/.exec(t)) && MONTHS.includes(m[1]!.slice(0, 3) as (typeof MONTHS)[number])) {
      base.month = MONTHS.indexOf(m[1]!.slice(0, 3) as (typeof MONTHS)[number]) + 1;
    } else {
      throw new DateError(`can't read "${t}" in "${text}"; try "on the 15th", "on the last day", "on the 2nd tuesday" or "in october"`);
    }
  }
  return validateRecurrence(base);
}

const ORDINAL_TEXT = (n: number) => (n === -1 ? "last" : `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`);
const WEEKDAY_NAMES: Record<Weekday, string> = { sun: "Sunday", mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday",
                                                  fri: "Friday", sat: "Saturday" };
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
                     "November", "December"];

export function describeRecurrence(r: Recurrence): string {
  const named: Record<string, string> = { "1day": "daily", "1week": "weekly", "2week": "every 2 weeks", "1month": "monthly",
                                          "3month": "every 3 months", "1year": "yearly" };
  let text = named[`${r.every}${r.unit}`] ?? `every ${r.every} ${r.unit}s`;
  if (r.nth) text += ` on the ${ORDINAL_TEXT(r.nth.n)} ${WEEKDAY_NAMES[r.nth.weekday]}`;
  else if (r.day === "last") text += " on the last day";
  else if (r.day) text += ` on the ${ORDINAL_TEXT(r.day)}`;
  if (r.month) text += ` in ${MONTH_NAMES[r.month - 1]}`;
  return text;
}
