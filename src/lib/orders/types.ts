import type { Database } from "@/integrations/supabase/types";

export const ORDER_STATUSES = ["draft", "confirmed", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type Order = Database["public"]["Tables"]["workspace_orders"]["Row"];
export type OrderContext =
  Database["public"]["Functions"]["get_workspace_order_context"]["Returns"][number];
export type OrderListResponse = { orders: Order[] };
