import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { ApiError } from "@/lib/api-error";
import { OfferService } from "./service";
import { OfferWriteSchema } from "./validation";

export class OfferController {
  private readonly service: OfferService;

  constructor(client: SupabaseClient<Database>) {
    this.service = new OfferService(client);
  }

  list = (workspaceId: string, search: string) => this.service.list(workspaceId, search);

  create = async (workspaceId: string, body: unknown) => {
    const input = OfferWriteSchema.parse(body);
    return this.service.create(workspaceId, input);
  };

  update = async (workspaceId: string, offerId: string, body: unknown) => {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(offerId)
    ) {
      throw new ApiError(400, "Offer id is invalid", "VALIDATION_ERROR");
    }
    const input = OfferWriteSchema.parse(body);
    return this.service.update(workspaceId, offerId, input);
  };
}
