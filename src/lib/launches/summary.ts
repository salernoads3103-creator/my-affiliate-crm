import type { LandingPage } from "@/lib/landings/types";
import type { OfferCatalogItem } from "@/lib/offers/types";

export type LaunchSummaryStatus = "Draft" | "Ready" | "Published" | "Error";
export type LaunchWorkflowSummary = {
  launchId: string;
  offerId: string;
  stage: "offer_created" | "landing_created" | "adapter_prepared" | "published";
  lastErrorCode: string | null;
  url: string | null;
  isProcessing: boolean;
  hostId: string;
  hostname: string | null;
  createdAt?: string;
};

export type LaunchSummary = {
  offer: OfferCatalogItem;
  landings: LandingPage[];
  landingCount: number;
  status: LaunchSummaryStatus;
  publishedUrl: string | null;
  hostname: string | null;
  workflow: LaunchWorkflowSummary | null;
};

function derivedStatus(
  landings: LandingPage[],
  workflow: LaunchWorkflowSummary | null,
): LaunchSummaryStatus {
  if (workflow) {
    if (workflow.stage === "published") return "Published";
    if (workflow.lastErrorCode) return "Error";
    if (workflow.stage === "adapter_prepared") return "Ready";
    return "Draft";
  }
  if (landings.some((landing) => landing.status === "published")) {
    return "Published";
  }
  if (landings.some((landing) => landing.status === "error")) return "Error";
  if (landings.some((landing) => landing.status === "ready")) return "Ready";
  return "Draft";
}

function publishedUrl(
  landings: LandingPage[],
  workflow: LaunchWorkflowSummary | null,
): string | null {
  if (workflow?.stage === "published") return workflow.url;
  const latestPublished = [...landings]
    .filter((landing) => landing.status === "published")
    .sort((left, right) => right.created_at.localeCompare(left.created_at))[0];
  return latestPublished?.published_url ?? null;
}

/** Builds an offer-centered launch view from the existing offer and landing APIs. */
export function buildLaunchSummaries(
  offers: OfferCatalogItem[],
  landings: LandingPage[],
  workflows: LaunchWorkflowSummary[] = [],
): LaunchSummary[] {
  const landingsByOffer = new Map<string, LandingPage[]>();
  for (const landing of landings) {
    const current = landingsByOffer.get(landing.offer_id) ?? [];
    current.push(landing);
    landingsByOffer.set(landing.offer_id, current);
  }

  return offers.map((offer) => {
    const offerLandings = landingsByOffer.get(offer.id) ?? [];
    const workflow =
      workflows
        .filter((item) => item.offerId === offer.id)
        .sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""))[0] ??
      null;
    return {
      offer,
      landings: offerLandings,
      landingCount: offerLandings.length,
      status: derivedStatus(offerLandings, workflow),
      publishedUrl: publishedUrl(offerLandings, workflow),
      hostname: workflow?.hostname ?? null,
      workflow,
    };
  });
}
