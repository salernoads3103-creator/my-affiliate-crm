/** Normalizes supported Ukrainian phone inputs to +380XXXXXXXXX. */
export function normalizeUkrainianPhone(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;

  const phone = value.trim();
  if (!phone || !/^\+?[\d\s().-]+$/.test(phone)) return null;

  const digits = phone.replace(/\D/g, "");
  if (/^380\d{9}$/.test(digits)) return `+${digits}`;
  if (/^0\d{9}$/.test(digits)) return `+38${digits}`;
  return null;
}
