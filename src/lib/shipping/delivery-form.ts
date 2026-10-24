import { formatMinorUnitsInput, parseUahToMinorUnits } from "@/lib/products/money";
import type {
  DeliveryPaymentMethod,
  DeliveryPayer,
  CodService,
  DeliveryType,
  OrderDelivery,
  OrderDeliveryInput,
} from "@/lib/shipping/types";
import type { Order } from "@/lib/orders/types";
import { centimetersToMillimeters, millimetersToCentimetersInput } from "@/lib/shipping/dimensions";

type OrderShippingSnapshot = Pick<
  Order,
  | "product_weight_grams_snapshot"
  | "product_length_mm_snapshot"
  | "product_width_mm_snapshot"
  | "product_height_mm_snapshot"
>;

export type DeliveryDraftForm = {
  deliveryType: DeliveryType | "";
  cityRef: string;
  cityName: string;
  branchRef: string;
  branchName: string;
  weightGrams: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  declaredValueUah: string;
  payer: DeliveryPayer | "";
  paymentMethod: DeliveryPaymentMethod | "";
  codAmountUah: string;
  codService: CodService | "";
};

export const EMPTY_DELIVERY_FORM: DeliveryDraftForm = {
  deliveryType: "",
  cityRef: "",
  cityName: "",
  branchRef: "",
  branchName: "",
  weightGrams: "",
  lengthCm: "",
  widthCm: "",
  heightCm: "",
  declaredValueUah: "",
  payer: "",
  paymentMethod: "",
  codAmountUah: "",
  codService: "",
};

export function deliveryFormFromRow(
  row: OrderDelivery | null,
  orderSnapshot?: OrderShippingSnapshot | null,
): DeliveryDraftForm {
  if (!row) return deliveryFormFromOrderSnapshot(orderSnapshot);
  return {
    deliveryType: row.delivery_type ?? "",
    cityRef: row.recipient_city_ref ?? "",
    cityName: row.recipient_city_name ?? "",
    branchRef: row.recipient_branch_ref ?? "",
    branchName: row.recipient_branch_name ?? "",
    weightGrams: row.weight_grams == null ? "" : String(row.weight_grams),
    lengthCm: millimetersToCentimetersInput(row.length_mm),
    widthCm: millimetersToCentimetersInput(row.width_mm),
    heightCm: millimetersToCentimetersInput(row.height_mm),
    declaredValueUah:
      row.declared_value_minor == null ? "" : formatMinorUnitsInput(row.declared_value_minor),
    payer: row.delivery_payer ?? "",
    paymentMethod: row.delivery_payment_method ?? "",
    codAmountUah: row.cod_amount_minor == null ? "" : formatMinorUnitsInput(row.cod_amount_minor),
    codService: row.cod_service ?? "",
  };
}

export function deliveryFormFromOrderSnapshot(
  order: OrderShippingSnapshot | null | undefined,
): DeliveryDraftForm {
  return {
    ...EMPTY_DELIVERY_FORM,
    weightGrams:
      order?.product_weight_grams_snapshot == null
        ? ""
        : String(order.product_weight_grams_snapshot),
    lengthCm: millimetersToCentimetersInput(order?.product_length_mm_snapshot),
    widthCm: millimetersToCentimetersInput(order?.product_width_mm_snapshot),
    heightCm: millimetersToCentimetersInput(order?.product_height_mm_snapshot),
  };
}

export function deliveryFormFromLead(context: {
  delivery_type: string | null;
  city_ref: string | null;
  city_name: string | null;
  branch_ref: string | null;
  branch_name: string | null;
  product_weight_grams: number | null;
  product_length_mm: number | null;
  product_width_mm: number | null;
  product_height_mm: number | null;
}): DeliveryDraftForm {
  const deliveryType: DeliveryType | "" =
    context.delivery_type === "warehouse" ||
    context.delivery_type === "postomat" ||
    context.delivery_type === "address"
      ? context.delivery_type
      : "";
  const hasCityRef = isNovaPoshtaV2Ref(context.city_ref) && Boolean(context.city_name?.trim());
  const hasBranchRef =
    hasCityRef && isNovaPoshtaV2Ref(context.branch_ref) && Boolean(context.branch_name?.trim());
  // Lead values are only carried forward when they look like paired v2 Ref/label values;
  // the server still validates these references against Nova Poshta before waybill creation.
  return {
    ...EMPTY_DELIVERY_FORM,
    deliveryType,
    cityRef: hasCityRef ? context.city_ref! : "",
    cityName: hasCityRef ? context.city_name! : "",
    branchRef: hasBranchRef ? context.branch_ref! : "",
    branchName: hasBranchRef ? context.branch_name! : "",
    weightGrams: context.product_weight_grams == null ? "" : String(context.product_weight_grams),
    lengthCm: millimetersToCentimetersInput(context.product_length_mm),
    widthCm: millimetersToCentimetersInput(context.product_width_mm),
    heightCm: millimetersToCentimetersInput(context.product_height_mm),
  };
}

function isNovaPoshtaV2Ref(value: string | null): value is string {
  return value !== null && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}

export function toOrderDeliveryInput(value: DeliveryDraftForm): OrderDeliveryInput {
  const weight = value.weightGrams.trim() ? Number(value.weightGrams) : null;
  const length = centimetersToMillimeters(value.lengthCm);
  const width = centimetersToMillimeters(value.widthCm);
  const height = centimetersToMillimeters(value.heightCm);
  if (weight !== null && (!Number.isInteger(weight) || weight < 1 || weight > 30_000)) {
    throw new Error("Enter a valid weight in grams");
  }
  if (
    [length, width, height].some(
      (dimension) =>
        dimension !== null && (!Number.isInteger(dimension) || dimension < 1 || dimension > 3_000),
    )
  ) {
    throw new Error("Enter valid parcel dimensions in centimeters (maximum 300 cm)");
  }
  return {
    deliveryType: value.deliveryType || null,
    cityRef: value.cityRef || null,
    cityName: value.cityName || null,
    branchRef: value.branchRef || null,
    branchName: value.branchName || null,
    weightGrams: weight,
    lengthMm: length,
    widthMm: width,
    heightMm: height,
    declaredValueMinor: value.declaredValueUah.trim()
      ? parseUahToMinorUnits(value.declaredValueUah)
      : null,
    payer: value.payer || null,
    paymentMethod: value.paymentMethod || null,
    codAmountMinor: value.codAmountUah.trim() ? parseUahToMinorUnits(value.codAmountUah) : null,
    codService: value.codAmountUah.trim() ? value.codService || null : null,
  };
}
