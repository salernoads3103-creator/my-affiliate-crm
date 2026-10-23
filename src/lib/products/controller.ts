import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { ApiError } from "@/lib/api-error";
import { ProductService } from "./service";
import { CreateProductSchema, UpdateProductSchema } from "./validation";

export class ProductController {
  private readonly service: ProductService;

  constructor(client: SupabaseClient<Database>) {
    this.service = new ProductService(client);
  }

  list = (workspaceId: string, search: string, canReadCost: boolean) =>
    this.service.list(workspaceId, search, canReadCost);

  create = async (workspaceId: string, body: unknown) => {
    const input = CreateProductSchema.parse(body);
    return this.service.create(workspaceId, input);
  };

  update = async (productId: string, body: unknown) => {
    if (!productId) throw new ApiError(400, "Product id is required", "VALIDATION_ERROR");
    const input = UpdateProductSchema.parse(body);
    const updateCost =
      !!body && typeof body === "object" && Object.prototype.hasOwnProperty.call(body, "costPrice");
    return this.service.update(productId, input, updateCost);
  };
}
