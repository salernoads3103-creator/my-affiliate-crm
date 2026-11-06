import { createFileRoute, redirect } from "@tanstack/react-router";

/** Preserve saved `/integrations` links without rendering a redundant hub page. */
export const Route = createFileRoute("/_authenticated/integrations")({
  beforeLoad: () => {
    throw redirect({ to: "/domains", replace: true });
  },
  component: () => null,
});
