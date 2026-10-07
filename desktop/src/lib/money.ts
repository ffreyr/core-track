/**
 * Money formatting and parsing.
 *
 * Formatting uses `Intl.NumberFormat` with the system locale so the symbol
 * position and separators match the user's macOS settings. Formatters are
 * cached per currency/variant because constructing them is relatively slow
 * and the calendar formats many amounts per render.
 */

const formatterCache = new Map<string, Intl.NumberFormat>();

/** Return a cached currency formatter. */
function getFormatter(currency: string, compact: boolean): Intl.NumberFormat {
  const key = `${currency}|${compact ? "c" : "f"}`;
  let formatter = formatterCache.get(key);
  if (!formatter) {
    try {
      formatter = new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        // "₺" / "$" instead of "TRY" / "US$" regardless of the system locale.
        currencyDisplay: "narrowSymbol",
        // Compact mode (calendar cells) drops decimals for whole amounts.
        minimumFractionDigits: compact ? 0 : 2,
        maximumFractionDigits: 2,
      });
    } catch {
      // Unknown currency code: fall back to a plain number with the code appended later.
      formatter = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    formatterCache.set(key, formatter);
  }
  return formatter;
}

/** Options for {@link formatMoney}. */
export interface FormatMoneyOptions {
  /** Prefix positive values with "+" (negatives always get "−"). */
  signed?: boolean;
  /** Omit ".00" on whole amounts, for dense UI like calendar cells. */
  compact?: boolean;
}

/**
 * Format an amount for display, e.g. `formatMoney(-42.5, "TRY")` → "−₺42,50".
 */
export function formatMoney(amount: number, currency: string, options: FormatMoneyOptions = {}): string {
  const formatter = getFormatter(currency, options.compact ?? false);
  const body = formatter.format(Math.abs(amount));
  const withCode = formatter.resolvedOptions().style === "currency" ? body : `${body} ${currency}`;
  if (amount < 0) {
    return `−${withCode}`;
  }
  if (options.signed && amount > 0) {
    return `+${withCode}`;
  }
  return withCode;
}

/**
 * Parse a user-typed amount into a positive number with at most two decimals.
 *
 * Accepts both "1234.50" and the Turkish/European "1234,50"; thousands
 * separators are not supported to keep the rule unambiguous.
 *
 * @returns The amount, or `null` if the input is not a valid positive amount.
 */
export function parseAmountInput(raw: string): number | null {
  const normalized = raw.trim().replace(",", ".");
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(normalized)) {
    return null;
  }
  const value = Number(normalized);
  return value > 0 ? value : null;
}
