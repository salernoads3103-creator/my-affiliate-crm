import { formatMinorUnitsInput } from "@/lib/products/money";
import type { Order, OrderContext } from "./types";

export type OrderFormValues = {
  quantity: string;
  unitPriceUah: string;
  buyerName: string;
  buyerPhone: string;
  buyerEmail: string;
  operatorComment: string;
};

export const EMPTY_ORDER_FORM: OrderFormValues = {
  quantity: "1",
  unitPriceUah: "",
  buyerName: "",
  buyerPhone: "",
  buyerEmail: "",
  operatorComment: "",
};

export function orderFormFromLeadContext(context: OrderContext): OrderFormValues {
  const price = context.offer_price_minor ?? context.product_sale_price_minor;
  return {
    quantity: "1",
    unitPriceUah: formatMinorUnitsInput(price),
    buyerName: context.lead_name,
    buyerPhone: context.buyer_phone ?? "",
    buyerEmail: context.buyer_email ?? "",
    operatorComment: "",
  };
}

export function preserveManualOrderFormValues(
  current: OrderFormValues,
  context: OrderContext,
  manuallyEdited: ReadonlySet<keyof OrderFormValues>,
): OrderFormValues {
  const defaults = orderFormFromLeadContext(context);
  return {
    quantity: manuallyEdited.has("quantity") ? current.quantity : defaults.quantity,
    unitPriceUah: manuallyEdited.has("unitPriceUah") ? current.unitPriceUah : defaults.unitPriceUah,
    buyerName: manuallyEdited.has("buyerName") ? current.buyerName : defaults.buyerName,
    buyerPhone: manuallyEdited.has("buyerPhone") ? current.buyerPhone : defaults.buyerPhone,
    buyerEmail: manuallyEdited.has("buyerEmail") ? current.buyerEmail : defaults.buyerEmail,
    operatorComment: manuallyEdited.has("operatorComment")
      ? current.operatorComment
      : defaults.operatorComment,
  };
}

export function orderFormFromOrder(order: Order): OrderFormValues {
  return {
    quantity: String(order.quantity),
    unitPriceUah: formatMinorUnitsInput(order.unit_price_minor),
    buyerName: order.buyer_name,
    buyerPhone: order.buyer_phone,
    buyerEmail: order.buyer_email ?? "",
    operatorComment: order.operator_comment ?? "",
  };
}
