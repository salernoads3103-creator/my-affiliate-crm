import { describe, expect, it } from "bun:test";
import { formatMinorUnitsInput, parseUahToMinorUnits } from "../src/lib/products/money";
import { CreateProductSchema, UpdateProductSchema } from "../src/lib/products/validation";
import { t } from "../src/lib/i18n";

describe("product money values", () => {
  it("converts decimal UAH text to exact integer kopiykas", () => {
    expect(parseUahToMinorUnits("129.90")).toBe(12990);
    expect(parseUahToMinorUnits("129,9")).toBe(12990);
    expect(parseUahToMinorUnits("0.00", true)).toBe(0);
    expect(formatMinorUnitsInput(12005)).toBe("120.05");
  });

  it("rejects zero sale price and amounts with more than two decimal places", () => {
    expect(() => parseUahToMinorUnits("0")).toThrow();
    expect(() => parseUahToMinorUnits("10.999")).toThrow();
    expect(() => parseUahToMinorUnits("1e3")).toThrow();
  });
});

describe("product input contracts", () => {
  it("accepts a minimal product without SKU, cost, image, weight, or supplier", () => {
    expect(
      CreateProductSchema.parse({
        name: "  Example offer item  ",
        salePrice: "249.50",
        isActive: true,
      }),
    ).toMatchObject({
      name: "Example offer item",
      salePrice: 24950,
      sku: null,
      photoUrl: null,
      weightGrams: null,
      supplierName: null,
      isActive: true,
    });
  });

  it("validates optional financial and delivery-related product fields", () => {
    expect(
      UpdateProductSchema.parse({
        name: "Bottle",
        sku: "BOT-01",
        salePrice: "310",
        costPrice: "125.75",
        photoUrl: "https://cdn.example.test/bottle.jpg",
        weightGrams: "450",
        supplierName: "Local supplier",
        isActive: false,
      }),
    ).toMatchObject({
      salePrice: 31000,
      costPrice: 12575,
      weightGrams: 450,
      isActive: false,
    });
  });

  it("rejects invalid names, URLs, weights, and prices", () => {
    expect(() => CreateProductSchema.parse({ name: " ", salePrice: "12" })).toThrow();
    expect(() => CreateProductSchema.parse({ name: "Item", salePrice: "12.345" })).toThrow();
    expect(() =>
      CreateProductSchema.parse({ name: "Item", salePrice: "12", photoUrl: "javascript:alert(1)" }),
    ).toThrow();
    expect(() =>
      CreateProductSchema.parse({ name: "Item", salePrice: "12", weightGrams: "1.5" }),
    ).toThrow();
  });

  it("keeps product UI labels available in Ukrainian and English", () => {
    expect(t("Products", {}, "uk")).toBe("Товари");
    expect(t("Cost price", {}, "uk")).toBe("Собівартість");
    expect(t("Products", {}, "en")).toBe("Products");
    expect(t("Cost price", {}, "en")).toBe("Cost price");
  });
});
