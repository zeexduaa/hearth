/**
 * Amounts of money, kept as whole cents with a currency code, so that adding up
 * a year of bills gives exactly the right total (0.1 + 0.2 is 0.30000000000000004
 * in floating point). Different currencies are never added together.
 */

export interface Money {
  cents: number;
  currency: string;          // ISO 4217: USD, EUR, GBP, PKR...
}

export class MoneyError extends Error {
  override name = "MoneyError";
}

const SYMBOLS: Record<string, string> = { $: "USD", "€": "EUR", "£": "GBP", "¥": "JPY", "₹": "INR", "₨": "PKR", "Rs": "PKR" };
const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP", "ISK"]);

function decimals(currency: string): number {
  return ZERO_DECIMAL.has(currency) ? 0 : 2;
}

/** "12.50", "$12.50", "1,234.56 EUR", "€30", "Rs 2500", "2500 PKR". */
export function parseMoney(text: string, defaultCurrency: string): Money {
  let t = text.trim();
  let currency: string | undefined;
  const code = /^([A-Za-z]{3})\s*|\s*([A-Za-z]{3})$/.exec(t);
  if (code && !/^rs/i.test(t)) {
    currency = (code[1] ?? code[2])!.toUpperCase();
    t = t.replace(code[0], "").trim();
  }
  for (const [symbol, iso] of Object.entries(SYMBOLS)) {
    if (t.startsWith(symbol)) {
      currency ??= iso;
      t = t.slice(symbol.length).trim();
      break;
    }
  }
  currency ??= defaultCurrency.toUpperCase();
  const negative = t.startsWith("-");
  if (negative) t = t.slice(1).trim();
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/.test(t)) {
    throw new MoneyError(`"${text}" isn't an amount; type it like 12.50, $12.50 or 1,234.56 EUR`);
  }
  const [whole, fraction = ""] = t.replace(/,/g, "").split(".");
  const places = decimals(currency);
  if (fraction.length > places) throw new MoneyError(`${currency} amounts have ${places === 0 ? "no" : places} decimal places`);
  const cents = Number(whole) * 10 ** places + Number(fraction.padEnd(places, "0") || 0);
  if (!Number.isSafeInteger(cents) || cents > 1e13) throw new MoneyError(`${text} is too large`);
  return { cents: negative ? -cents : cents, currency };
}

export function formatMoney(m: Money): string {
  const places = decimals(m.currency);
  const negative = m.cents < 0;
  const abs = Math.abs(m.cents);
  const whole = Math.floor(abs / 10 ** places).toLocaleString("en-US");
  const fraction = places ? "." + String(abs % 10 ** places).padStart(places, "0") : "";
  const symbol = { USD: "$", EUR: "€", GBP: "£", JPY: "¥", INR: "₹" }[m.currency];
  const body = symbol ? `${symbol}${whole}${fraction}` : `${whole}${fraction} ${m.currency}`;
  return negative ? `-${body}` : body;
}

/** Totals per currency, in a stable order. */
export function totals(amounts: Iterable<Money | undefined>): Money[] {
  const sums = new Map<string, number>();
  for (const m of amounts) if (m) sums.set(m.currency, (sums.get(m.currency) ?? 0) + m.cents);
  return [...sums].sort(([a], [b]) => a.localeCompare(b)).map(([currency, cents]) => ({ currency, cents }));
}

export function formatTotals(list: Money[]): string {
  return list.length ? list.map(formatMoney).join(" + ") : "nothing";
}
