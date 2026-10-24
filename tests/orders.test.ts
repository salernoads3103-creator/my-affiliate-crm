import { describe, expect, it } from "bun:test";
import { t } from "../src/lib/i18n";
import { canTransitionOrderStatus } from "../src/lib/orders/status";
import { orderFormFromLeadContext, preserveManualOrderFormValues } from "../src/lib/orders/form";
import type { OrderContext } from "../src/lib/orders/types";
import {
  CreateOrderRequestSchema,
  CreateOrderSchema,
  UpdateOrderDraftRequestSchema,
  UpdateOrderDraftSchema,
} from "../src/lib/orders/validation";

const validOrder = {
  leadId: "11111111-1111-4111-8111-111111111111",
  idempotencyKey: "22222222-2222-4222-8222-222222222222",
  quantity: 2,
  unitPriceUah: "1190.50",
  buyerName: "  Олена  ",
  buyerPhone: "067 123 45 67",
  buyerEmail: "",
  operatorComment: " Передзвонити після 18:00 ",
};

function orderContext(offerPrice: number | null, productPrice = 129000): OrderContext {
  return {
    lead_id: "11111111-1111-4111-8111-111111111111",
    lead_name: "Олена Савчук",
    buyer_phone: "+380671234567",
    buyer_email: null,
    offer_id: "22222222-2222-4222-8222-222222222222",
    offer_name: "Акція",
    offer_price_minor: offerPrice,
    product_id: "33333333-3333-4333-8333-333333333333",
    product_name: "Бритва",
    product_sku: "BR-01",
    product_sale_price_minor: productPrice,
    product_weight_grams: null,
    product_length_mm: null,
    product_width_mm: null,
    product_height_mm: null,
    delivery_type: null,
    city_ref: null,
    city_name: null,
    branch_ref: null,
    branch_name: null,
  };
}

describe("order input and lifecycle", () => {
  it("normalizes Ukrainian contacts and converts UAH to exact kopiykas", () => {
    const parsed = CreateOrderRequestSchema.parse({
      ...validOrder,
      workspace_id: "33333333-3333-4333-8333-333333333333",
      product_id: "44444444-4444-4444-8444-444444444444",
      unit_price_minor: 1,
    });

    expect(parsed.buyerName).toBe("Олена");
    expect(parsed.buyerPhone).toBe("+380671234567");
    expect(parsed.buyerEmail).toBeNull();
    expect(parsed.unitPriceUah).toBe("1190.50");
    expect(CreateOrderSchema.parse(parsed).unitPriceMinor).toBe(119050);
    expect(parsed.operatorComment).toBe("Передзвонити після 18:00");
    expect(parsed).not.toHaveProperty("workspace_id");
    expect(parsed).not.toHaveProperty("product_id");
    expect(parsed).not.toHaveProperty("unit_price_minor");
  });

  it("creates an order from a lead with absent optional details and validates the API payload", () => {
    const formResult = CreateOrderRequestSchema.parse({
      ...validOrder,
      quantity: 1,
      unitPriceUah: "1190",
      buyerEmail: null,
      operatorComment: undefined,
    });
    const payload = JSON.parse(JSON.stringify(formResult)) as unknown;
    const serverResult = CreateOrderSchema.parse(payload);

    expect(formResult.unitPriceUah).toBe("1190");
    expect(serverResult.unitPriceMinor).toBe(119000);
    expect(serverResult.buyerEmail).toBeNull();
    expect(serverResult.operatorComment).toBeNull();
  });

  it("prefills the current offer price and keeps operator-edited price and quantity", () => {
    const firstContext = orderContext(119000);
    const firstValues = orderFormFromLeadContext(firstContext);
    expect(firstValues).toMatchObject({ unitPriceUah: "1190.00", quantity: "1" });

    const operatorValues = { ...firstValues, unitPriceUah: "1150", quantity: "3" };
    const refreshedContext = orderContext(109000);
    expect(orderFormFromLeadContext(refreshedContext).unitPriceUah).toBe("1090.00");
    expect(
      preserveManualOrderFormValues(
        operatorValues,
        refreshedContext,
        new Set(["unitPriceUah", "quantity"]),
      ),
    ).toEqual(operatorValues);
    expect(
      preserveManualOrderFormValues(
        { ...firstValues, quantity: "3" },
        refreshedContext,
        new Set(["quantity"]),
      ),
    ).toMatchObject({ unitPriceUah: "1090.00", quantity: "3" });
  });

  it("uses product sale price only when the offer has no price and leaves missing contacts blank", () => {
    const values = orderFormFromLeadContext({
      ...orderContext(null),
      buyer_phone: null,
      buyer_email: null,
    });

    expect(values).toMatchObject({
      unitPriceUah: "1290.00",
      buyerName: "Олена Савчук",
      buyerPhone: "",
      buyerEmail: "",
    });
  });

  it("normalizes optional email and comment when null, omitted, or blank", () => {
    for (const optionalFields of [
      { buyerEmail: null, operatorComment: null },
      { buyerEmail: undefined, operatorComment: undefined },
      { buyerEmail: "", operatorComment: "   " },
    ]) {
      const parsed = CreateOrderRequestSchema.parse({ ...validOrder, ...optionalFields });
      const serverPayload = JSON.parse(JSON.stringify(parsed)) as Record<string, unknown>;
      delete serverPayload.buyerEmail;
      delete serverPayload.operatorComment;
      const serverResult = CreateOrderSchema.parse(serverPayload);

      expect(serverResult.buyerEmail).toBeNull();
      expect(serverResult.operatorComment).toBeNull();
    }
  });

  it("rejects invalid phone, price, quantity, and idempotency identifiers", () => {
    expect(() =>
      CreateOrderRequestSchema.parse({ ...validOrder, buyerPhone: "555-123" }),
    ).toThrow();
    expect(() => CreateOrderRequestSchema.parse({ ...validOrder, unitPriceUah: "0" })).toThrow();
    expect(() => CreateOrderRequestSchema.parse({ ...validOrder, quantity: 0 })).toThrow();
    expect(() =>
      CreateOrderRequestSchema.parse({ ...validOrder, idempotencyKey: "not-a-uuid" }),
    ).toThrow();
    expect(() => CreateOrderRequestSchema.parse({ ...validOrder, buyerName: null })).toThrow();
  });

  it("accepts draft edits without client-supplied ownership or snapshot fields", () => {
    const parsed = UpdateOrderDraftRequestSchema.parse({
      quantity: 3,
      unitPriceUah: "1000",
      buyerName: "Олена",
      buyerPhone: "+380671234567",
      buyerEmail: null,
      operatorComment: null,
      workspaceId: "untrusted",
      productNameSnapshot: "changed by browser",
    });

    expect(parsed.unitPriceUah).toBe("1000");
    expect(parsed).not.toHaveProperty("workspaceId");
    expect(parsed).not.toHaveProperty("productNameSnapshot");
    expect(UpdateOrderDraftSchema.parse(parsed)).toMatchObject({ unitPriceMinor: 100000 });
  });

  it("keeps order lifecycle independent and prevents reopening cancelled orders", () => {
    expect(canTransitionOrderStatus("draft", "confirmed")).toBe(true);
    expect(canTransitionOrderStatus("draft", "cancelled")).toBe(true);
    expect(canTransitionOrderStatus("confirmed", "cancelled")).toBe(true);
    expect(canTransitionOrderStatus("confirmed", "draft")).toBe(false);
    expect(canTransitionOrderStatus("cancelled", "draft")).toBe(false);
    expect(canTransitionOrderStatus("cancelled", "confirmed")).toBe(false);
  });

  it("uses natural Ukrainian and English order labels", () => {
    expect(t("Orders", {}, "uk")).toBe("Замовлення");
    expect(t("Create order", {}, "uk")).toBe("Створити замовлення");
    expect(t("Unit price (UAH)", {}, "uk")).toBe("Ціна за одиницю (грн)");
    expect(t("Orders", {}, "en")).toBe("Orders");
    expect(t("Create order", {}, "en")).toBe("Create order");
  });
});
