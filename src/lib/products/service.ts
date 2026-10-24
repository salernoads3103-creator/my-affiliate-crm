import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { ApiError } from "@/lib/api-error";
import type { Product, ProductListResponse } from "./types";
import type { ProductInput } from "./validation";

type ProductClient = SupabaseClient<Database>;

function productDatabaseError(error: { code?: string; message?: string }): ApiError {
  if (error.code === "42501") return new ApiError(403, "Insufficient workspace permissions");
  if (error.code === "P0002" || error.code === "PGRST116")
    return new ApiError(404, "Product not found");
  if (["22023", "22P02", "23502", "23503", "23514"].includes(error.code ?? "")) {
    return new ApiError(400, "Invalid product data", "VALIDATION_ERROR");
  }
  return new ApiError(500, "The request could not be completed", "INTERNAL_ERROR", error);
}

function rpcInput(input: ProductInput) {
  return {
    p_name: input.name,
    p_sku: input.sku,
    p_sale_price_minor: input.salePrice,
    p_photo_url: input.photoUrl,
    p_weight_grams: input.weightGrams,
    p_length_mm: input.lengthMm,
    p_width_mm: input.widthMm,
    p_height_mm: input.heightMm,
    p_supplier_name: input.supplierName,
    p_is_active: input.isActive,
  };
}

export class ProductService {
  constructor(private readonly client: ProductClient) {}

  async list(
    workspaceId: string,
    search: string,
    canReadCost: boolean,
  ): Promise<ProductListResponse> {
    let query = this.client
      .from("products")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(500);

    const term = search
      .trim()
      .slice(0, 120)
      .replace(/[%,()"\\]/g, " ")
      .trim();
    if (term) {
      const pattern = `"%${term}%"`;
      query = query.or(`name.ilike.${pattern},sku.ilike.${pattern}`);
    }

    const { data, error } = await query;
    if (error) throw productDatabaseError(error);
    const products = (data ?? []) as Product[];

    if (!canReadCost || products.length === 0) return { products };
    const { data: costs, error: costError } = await this.client
      .from("product_costs")
      .select("product_id, cost_price_minor")
      .eq("workspace_id", workspaceId)
      .in(
        "product_id",
        products.map((product) => product.id),
      );
    if (costError) throw productDatabaseError(costError);

    const costByProduct = new Map(
      (costs ?? []).map((cost) => [cost.product_id, cost.cost_price_minor]),
    );
    return {
      products: products.map((product) => ({
        ...product,
        cost_price_minor: costByProduct.get(product.id) ?? null,
      })),
    };
  }

  async create(workspaceId: string, input: ProductInput): Promise<{ id: string }> {
    const { data, error } = await this.client.rpc("create_product_with_shipping_dimensions", {
      p_workspace_id: workspaceId,
      ...rpcInput(input),
      p_cost_price_minor: input.costPrice ?? null,
    });
    if (error) throw productDatabaseError(error);
    return { id: data };
  }

  async update(
    productId: string,
    input: ProductInput,
    updateCost: boolean,
  ): Promise<{ id: string }> {
    const { data, error } = await this.client.rpc("update_product_with_shipping_dimensions", {
      p_product_id: productId,
      ...rpcInput(input),
      p_update_cost: updateCost,
      p_cost_price_minor: input.costPrice ?? null,
    });
    if (error) throw productDatabaseError(error);
    return { id: data };
  }
}
