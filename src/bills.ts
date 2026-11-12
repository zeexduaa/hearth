/**
 * Recurring bills: when they're due, what was paid, and what they cost over time.
 *
 * Each due date is paid (or not) separately, and a payment records the amount
 * actually paid, which for electricity or water is different every time. Bills on
 * autopay are never shown as overdue, but their payments can still be recorded
 * to keep the amounts. Due dates from before the bill was added aren't counted
 * as unpaid: hearth didn't know about them.
 *
 * spending() and unusual() compare amounts over time, so a bill much higher than
 * usual stands out ("electricity: $182.40, 45% above the last 6 months").
 */

import { type LocalDate, type Recurrence, addDays, between, compare, daysBetween, nextOnOrAfter, validateRecurrence } from "./dates.js";
import { type Bill, type Data, type Payment, DataError, newId, pick } from "./model.js";
import { type Money, totals } from "./money.js";

export interface BillInput {
  name: string;
  recurrence: Recurrence;
  start: LocalDate;
  end?: LocalDate;
  amount?: Money;
  payee?: string;
  autopay?: boolean;
  notes?: string;
}

export function addBill(data: Data, input: BillInput, today: LocalDate): Bill {
  const name = input.name.trim();
  if (!name) throw new DataError("give the bill a name");
  if (data.bills.some((b) => b.name.toLowerCase() === name.toLowerCase())) throw new DataError(`there's already a bill called ${name}`);
  if (input.end && compare(input.end, input.start) < 0) throw new DataError("the last due date is before the first");
  if (input.amount && input.amount.cents <= 0) throw new DataError("the amount must be more than 0");
  const bill: Bill = { id: newId(), name, recurrence: validateRecurrence(input.recurrence), start: input.start,
                       autopay: input.autopay ?? false, payments: [], created: today };
  if (input.end) bill.end = input.end;
  if (input.amount) bill.amount = input.amount;
  if (input.payee) bill.payee = input.payee;
  if (input.notes) bill.notes = input.notes;
  data.bills.push(bill);
  return bill;
}

export function findBill(data: Data, query: string): Bill {
  return pick(data.bills, query, "bill");
}

/** Due dates with ``from <= date <= to``, stopping at the bill's end. */
export function dueDates(bill: Bill, from: LocalDate, to: LocalDate): LocalDate[] {
  const last = bill.end && compare(bill.end, to) < 0 ? bill.end : to;
  return compare(from, last) > 0 ? [] : between(bill.recurrence, bill.start, from, last);
}

function paidDues(bill: Bill): Set<LocalDate> {
  return new Set(bill.payments.map((p) => p.due));
}

export interface BillStatus {
  bill: Bill;
  due: LocalDate;
  daysLeft: number;          // negative: overdue
  amount?: Money;            // expected
}

/** Unpaid due dates up to ``today + days`` (overdue first). Autopay bills are listed as upcoming only. */
export function upcoming(data: Data, today: LocalDate, days: number): BillStatus[] {
  const out: BillStatus[] = [];
  for (const bill of data.bills) {
    const paid = paidDues(bill);
    const from = compare(bill.created, bill.start) > 0 ? bill.created : bill.start;
    for (const due of dueDates(bill, bill.autopay ? today : from, addDays(today, days))) {
      if (paid.has(due)) continue;
      const status: BillStatus = { bill, due, daysLeft: daysBetween(today, due) };
      if (bill.amount) status.amount = bill.amount;
      out.push(status);
    }
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft || a.bill.name.localeCompare(b.bill.name));
}

export interface PayOptions {
  amount?: Money;
  paid: LocalDate;
  due?: LocalDate;           // which due date; default: the earliest unpaid one
  note?: string;
}

export function pay(bill: Bill, options: PayOptions, lookaheadDays = 45): Payment {
  const paid = paidDues(bill);
  let due = options.due;
  if (due) {
    if (!dueDates(bill, due, due).length) throw new DataError(`${bill.name} isn't due on ${due}`);
    if (paid.has(due)) throw new DataError(`the ${due} ${bill.name} bill is already paid`);
  } else {
    const from = compare(bill.created, bill.start) > 0 ? bill.created : bill.start;
    due = dueDates(bill, from, addDays(options.paid, lookaheadDays)).find((d) => !paid.has(d));
    // Paying a bill with nothing open (an autopay recorded late, say): the latest due date on or before payment.
    due ??= dueDates(bill, bill.start, options.paid).filter((d) => !paid.has(d)).at(-1);
    if (!due) throw new DataError(`${bill.name} has no unpaid due date near ${options.paid}; give one with --due`);
  }
  const amount = options.amount ?? bill.amount;
  if (!amount) throw new DataError(`how much was the ${bill.name} bill? Give the amount`);
  if (amount.cents <= 0) throw new DataError("the amount must be more than 0");
  const payment: Payment = { due, paid: options.paid, amount };
  if (options.note) payment.note = options.note;
  bill.payments.push(payment);
  bill.payments.sort((a, b) => compare(a.due, b.due));
  return payment;
}

export function undoPayment(bill: Bill): Payment {
  const latest = [...bill.payments].sort((a, b) => compare(a.paid, b.paid)).at(-1);
  if (!latest) throw new DataError(`no payments are recorded for ${bill.name}`);
  bill.payments.splice(bill.payments.indexOf(latest), 1);
  return latest;
}

/** The next due date from ``today`` on that isn't paid yet (paying early moves it on). */
export function nextDue(bill: Bill, today: LocalDate): LocalDate | undefined {
  const paid = paidDues(bill);
  let next = nextOnOrAfter(bill.recurrence, bill.start, compare(today, bill.start) > 0 ? today : bill.start);
  for (let guard = 0; paid.has(next) && guard < 1000; guard++) next = nextOnOrAfter(bill.recurrence, bill.start, addDays(next, 1));
  return bill.end && compare(next, bill.end) > 0 ? undefined : next;
}

// -- spending ----------------------------------------------------------------------------------------------

export interface MonthSpending {
  month: string;             // "2026-03"
  total: Money[];
}

/** Payments per month (by the date paid), for the ``months`` months ending with ``today``'s. */
export function spending(data: Data, today: LocalDate, months: number): MonthSpending[] {
  const out: MonthSpending[] = [];
  const [y, m] = today.split("-").map(Number);
  for (let i = months - 1; i >= 0; i--) {
    const index = y! * 12 + (m! - 1) - i;
    const month = `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
    const payments = data.bills.flatMap((b) => b.payments).filter((p) => p.paid.startsWith(month));
    out.push({ month, total: totals(payments.map((p) => p.amount)) });
  }
  return out;
}

export interface Unusual {
  bill: Bill;
  payment: Payment;
  average: Money;
  percent: number;           // +45 means 45% above the average
}

/**
 * The latest payment of each bill compared with the average of the ones before it
 * (up to ``window``, same currency, at least 3 of them). Reported if it differs by
 * ``threshold`` percent or more.
 */
export function unusual(data: Data, window = 6, threshold = 25): Unusual[] {
  const out: Unusual[] = [];
  for (const bill of data.bills) {
    const sorted = [...bill.payments].sort((a, b) => compare(a.due, b.due));
    const latest = sorted.at(-1);
    if (!latest) continue;
    const before = sorted.slice(0, -1).filter((p) => p.amount.currency === latest.amount.currency).slice(-window);
    if (before.length < 3) continue;
    const average = Math.round(before.reduce((s, p) => s + p.amount.cents, 0) / before.length);
    if (average <= 0) continue;
    const percent = Math.round(((latest.amount.cents - average) / average) * 100);
    if (Math.abs(percent) >= threshold) {
      out.push({ bill, payment: latest, average: { cents: average, currency: latest.amount.currency }, percent });
    }
  }
  return out.sort((a, b) => Math.abs(b.percent) - Math.abs(a.percent));
}

/** What the bills come to in a typical month, from their expected amounts. */
export function monthlyEstimate(data: Data, today: LocalDate): Money[] {
  const perMonth = { day: 30.44, week: 30.44 / 7, month: 1, year: 1 / 12 };
  return totals(data.bills.filter((b) => b.amount && (!b.end || compare(b.end, today) >= 0)).map((b) => ({
    currency: b.amount!.currency,
    cents: Math.round((b.amount!.cents * perMonth[b.recurrence.unit]) / b.recurrence.every),
  })));
}
