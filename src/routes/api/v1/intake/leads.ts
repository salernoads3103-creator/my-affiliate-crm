import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createPublicIntakeHandler } from "@/lib/intake/handler";
import { LandingIntakeService } from "@/lib/intake/service";
import { hashClientIpForRateLimit } from "@/lib/intake/server-utils.server";

const handleIntake = createPublicIntakeHandler({
  backend: new LandingIntakeService(supabaseAdmin),
  hashIp: hashClientIpForRateLimit,
});

export const Route = createFileRoute("/api/v1/intake/leads")({
  server: {
    handlers: {
      POST: ({ request }) => handleIntake(request),
      OPTIONS: ({ request }) => handleIntake(request),
    },
  },
});
