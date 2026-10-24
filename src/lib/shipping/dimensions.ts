const MAX_MILLIMETERS = 2_147_483_647n;

/** Format canonical integer millimeters as a centimeter value for UI inputs. */
export function millimetersToCentimetersInput(value: number | null | undefined): string {
  if (value == null) return "";
  const millimeters = BigInt(value);
  const centimeters = millimeters / 10n;
  const remainder = millimeters % 10n;
  return remainder === 0n ? String(centimeters) : `${centimeters}.${remainder}`;
}

/** Parse a UI centimeter value with 1 mm precision into canonical integer millimeters. */
export function centimetersToMillimeters(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return null;

  const match = /^(\d+)(?:\.(\d))?$/.exec(normalized);
  if (!match) {
    throw new Error("Enter a dimension in centimeters with up to one decimal place");
  }

  const millimeters = BigInt(match[1]) * 10n + BigInt(match[2] ?? "0");
  if (millimeters < 1n || millimeters > MAX_MILLIMETERS) {
    throw new Error("Enter a valid positive dimension in centimeters");
  }
  return Number(millimeters);
}
