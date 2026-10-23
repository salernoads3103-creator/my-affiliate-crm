const MAX_SAFE_MINOR_UNITS = BigInt(Number.MAX_SAFE_INTEGER);

/** Converts a user-entered UAH amount into exact integer kopiykas. */
export function parseUahToMinorUnits(value: string, allowZero = false): number {
  const normalized = value.trim().replace(",", ".");
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) throw new Error("Enter a UAH amount with up to two decimal places");

  const whole = BigInt(match[1]);
  const fractional = BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  const minorUnits = whole * 100n + fractional;
  if ((!allowZero && minorUnits === 0n) || minorUnits > MAX_SAFE_MINOR_UNITS) {
    throw new Error("Enter a valid UAH amount");
  }
  return Number(minorUnits);
}

export function formatMinorUnitsInput(value: number | null | undefined): string {
  if (value == null) return "";
  const minorUnits = BigInt(value);
  const whole = minorUnits / 100n;
  const fraction = String(minorUnits % 100n).padStart(2, "0");
  return `${whole}.${fraction}`;
}

export function formatMinorUnits(value: number, locale: "uk" | "en"): string {
  return new Intl.NumberFormat(locale === "uk" ? "uk-UA" : "en-US", {
    style: "currency",
    currency: "UAH",
  }).format(value / 100);
}
