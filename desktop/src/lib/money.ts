/**
 * Money formatting and parsing.
 *
 * Formatting uses `Intl.NumberFormat` with the system locale so the symbol
 * position and separators match the user's macOS settings. Formatters are
 * cached per currency/variant because constructing them is relatively slow
 * and the calendar formats many amounts per render.
 */

const formatterCache = new Map<string, Intl.NumberFormat>();

/**
 * Formatter variants:
 *  - `full`  – always two decimals ("₺842.50"), for exact figures.
 *  - `cents` – compact, up to two decimals with no padding ("₺42", "₺9.9").
 *  - `whole` – compact, no decimals ("₺843"), for glanceable large amounts.
 */
type Variant = "full" | "cents" | "whole";

/** Return a cached currency formatter for a variant. */
function getFormatter(currency: string, variant: Variant): Intl.NumberFormat {
  const key = `${currency}|${variant}`;
  let formatter = formatterCache.get(key);
  if (!formatter) {
    const digits =
      variant === "full"
        ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
        : variant === "cents"
          ? { minimumFractionDigits: 0, maximumFractionDigits: 2 }
          : { minimumFractionDigits: 0, maximumFractionDigits: 0 };
    try {
      formatter = new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        // "₺" / "$" instead of "TRY" / "US$" regardless of the system locale.
        currencyDisplay: "narrowSymbol",
        ...digits,
      });
    } catch {
      // Unknown currency code: fall back to a plain number with the code appended later.
      formatter = new Intl.NumberFormat(undefined, digits);
    }
    formatterCache.set(key, formatter);
  }
  return formatter;
}

/** Options for {@link formatMoney}. */
export interface FormatMoneyOptions {
  /** Prefix positive values with "+" (negatives always get "−"). */
  signed?: boolean;
  /**
   * Glanceable form for dense UI (calendar chips, toolbar stats, cards):
   * amounts of 100 or more are rounded to whole units ("₺31,458" rather
   * than "₺31,457.6"); smaller amounts keep their cents without padding
   * ("₺9.9", "₺42"). Exact figures elsewhere use the default full form.
   */
  compact?: boolean;
}

/**
 * Format an amount for display, e.g. `formatMoney(-42.5, "TRY")` → "−₺42.50".
 */
export function formatMoney(amount: number, currency: string, options: FormatMoneyOptions = {}): string {
  const variant: Variant = !options.compact ? "full" : Math.abs(amount) >= 100 ? "whole" : "cents";
  const formatter = getFormatter(currency, variant);
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
