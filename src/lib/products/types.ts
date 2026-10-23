import type { Tables } from "@/integrations/supabase/types";

export type Product = Tables<"products"> & {
  /** Present only when the authenticated user has products.cost.read. */
  cost_price_minor?: number | null;
};

export type ProductListResponse = {
  products: Product[];
};

export type ProductWriteRequest = {
  name: string;
  sku: string;
  salePrice: string;
  costPrice?: string;
  photoUrl: string;
  weightGrams: string;
  supplierName: string;
  isActive: boolean;
};
