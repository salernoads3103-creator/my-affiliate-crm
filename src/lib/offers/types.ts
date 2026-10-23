import type { Database } from "@/integrations/supabase/types";

export type OfferCatalogItem =
  Database["public"]["Functions"]["get_workspace_offer_catalog"]["Returns"][number];

export type OfferCatalogResponse = {
  offers: OfferCatalogItem[];
};

export type OfferWriteRequest = {
  productId: string;
  name: string;
  priceUah: string;
  landingUrl: string;
  isActive: boolean;
};

export type LeadOfferOption = {
  id: string;
  name: string;
  created_at: string;
};
