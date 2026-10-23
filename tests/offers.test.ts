import { describe, expect, it } from "bun:test";
import { OfferWriteSchema } from "../src/lib/offers/validation";
import { t } from "../src/lib/i18n";

describe("offer input contract", () => {
  it("accepts a product-backed offer and stores the price in exact kopiykas", () => {
    expect(
      OfferWriteSchema.parse({
        productId: "11111111-1111-4111-8111-111111111111",
        name: "  Razor special  ",
        priceUah: "1190.00",
        landingUrl: "https://shop.example.test/razor",
        isActive: true,
        workspace_id: "22222222-2222-4222-8222-222222222222",
      }),
    ).toEqual({
      productId: "11111111-1111-4111-8111-111111111111",
      name: "Razor special",
      priceUah: 119000,
      landingUrl: "https://shop.example.test/razor",
      isActive: true,
    });
  });

  it("allows an empty landing URL and keeps the offer price separate from product fields", () => {
    const parsed = OfferWriteSchema.parse({
      productId: "11111111-1111-4111-8111-111111111111",
      name: "Razor special",
      priceUah: "1190",
      landingUrl: "",
      isActive: true,
    });

    expect(parsed.priceUah).toBe(119000);
    expect(parsed.landingUrl).toBeNull();
    expect(parsed).not.toHaveProperty("salePrice");
  });

  it("rejects invalid product IDs, non-positive prices, and non-web URLs", () => {
    const base = {
      productId: "11111111-1111-4111-8111-111111111111",
      name: "Razor special",
      priceUah: "1190",
      landingUrl: "",
      isActive: true,
    };

    expect(() => OfferWriteSchema.parse({ ...base, productId: "not-a-uuid" })).toThrow();
    expect(() => OfferWriteSchema.parse({ ...base, priceUah: "0" })).toThrow();
    expect(() => OfferWriteSchema.parse({ ...base, landingUrl: "javascript:alert(1)" })).toThrow();
  });

  it("keeps offer labels natural in Ukrainian and English", () => {
    expect(t("Offers", {}, "uk")).toBe("Офери");
    expect(t("Offer price", {}, "uk")).toBe("Ціна офера");
    expect(t("Offers", {}, "en")).toBe("Offers");
    expect(t("Offer price", {}, "en")).toBe("Offer price");
  });
});
