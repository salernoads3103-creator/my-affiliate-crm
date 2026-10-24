import type { OrderStatus } from "./types";

/** Order lifecycle stays separate from lead and shipment status. */
export function canTransitionOrderStatus(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return true;
  if (from === "draft") return to === "confirmed" || to === "cancelled";
  return from === "confirmed" && to === "cancelled";
}
