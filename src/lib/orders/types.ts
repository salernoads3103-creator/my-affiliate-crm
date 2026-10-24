import type { Database } from "@/integrations/supabase/types";

export const ORDER_STATUSES = ["draft", "confirmed", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type Order = Database["public"]["Tables"]["workspace_orders"]["Row"];
export type OrderContext =
  Database["public"]["Functions"]["get_workspace_order_context_v2"]["Returns"][number] & {
    delivery_type: string | null;
    city_ref: string | null;
    city_name: string | null;
    branch_ref: string | null;
    branch_name: string | null;
  };
export type OrderListResponse = { orders: Order[] };
