import { describe, expect, test } from "bun:test";

import { isLocale, leadCountLabel, localizeError, t, translateLabel } from "../src/lib/i18n";
import { LEAD_STATUSES } from "../src/lib/leads/types";
import { isThemePreference, normalizeThemePreference, resolveTheme } from "../src/lib/theme";

describe("bilingual UI catalog", () => {
  test("localizes lead status labels without changing their API values", () => {
    expect(LEAD_STATUSES).toEqual(["New", "Contacted", "Qualified", "Converted", "Lost"]);
    expect(LEAD_STATUSES.map((status) => t(status, {}, "uk"))).toEqual([
      "Новий",
      "У контакті",
      "Кваліфікований",
      "Клієнт",
      "Втрачений",
    ]);
    expect(LEAD_STATUSES.map((status) => t(status, {}, "en"))).toEqual(LEAD_STATUSES);
  });

  test("localizes dynamic role and message labels", () => {
    expect(translateLabel("super_admin")).toBe("Суперадміністратор");
    expect(t("Create an account to join {workspace}.", { workspace: "Команда" })).toContain("Команда");
    expect(leadCountLabel(22)).toBe("22 ліди");
    expect(leadCountLabel(1, "en")).toBe("1 lead");
    expect(leadCountLabel(2, "en")).toBe("2 leads");
  });

  test("uses a safe localized fallback for unknown errors", () => {
    expect(localizeError(new Error("database detail"), "Не вдалося виконати дію.")).toBe(
      "Не вдалося виконати дію.",
    );
  });

  test("supports both languages and preserves unknown permission identifiers", () => {
    expect(t("Dashboard", {}, "uk")).toBe("Огляд");
    expect(t("Dashboard", {}, "en")).toBe("Dashboard");
    expect(t("Audit Log", {}, "uk")).toBe("Журнал дій");
    expect(t("Audit Log", {}, "en")).toBe("Audit log");
    expect(translateLabel("members.read", "uk")).toBe("members.read");
    expect(translateLabel("operator", "en")).toBe("Operator");
    expect(isLocale("uk")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("fr")).toBe(false);
  });
});

describe("theme preference resolution", () => {
  test("resolves light, dark and migrates legacy system preference", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(normalizeThemePreference("system", true)).toBe("dark");
    expect(normalizeThemePreference("system", false)).toBe("light");
    expect(normalizeThemePreference("sepia", true)).toBe("dark");
  });

  test("accepts only the two user-selectable themes", () => {
    expect(isThemePreference("system")).toBe(false);
    expect(isThemePreference("light")).toBe(true);
    expect(isThemePreference("dark")).toBe(true);
    expect(isThemePreference("sepia")).toBe(false);
  });
});
