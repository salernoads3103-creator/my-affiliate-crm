import { describe, expect, test } from "bun:test";
import type { LandingPage } from "../src/lib/landings/types";
import type { OfferCatalogItem } from "../src/lib/offers/types";
import { buildLaunchSummaries } from "../src/lib/launches/summary";

function makeOffer(overrides: Partial<OfferCatalogItem> = {}): OfferCatalogItem {
  return {
    id: "offer-1",
    name: "Razor offer",
    product_name: "Razor",
    offer_price_minor: 119000,
    landing_url: null,
    is_active: true,
    ...overrides,
  } as OfferCatalogItem;
}

function makeLanding(overrides: Partial<LandingPage> = {}): LandingPage {
  return {
    id: "landing-1",
    offer_id: "offer-1",
    status: "draft",
    published_url: null,
    created_at: "2026-11-06T10:00:00.000Z",
    ...overrides,
  } as LandingPage;
}

describe("launch overview aggregation", () => {
  test("groups landing variants under their existing offer", () => {
    const rows = buildLaunchSummaries(
      [makeOffer()],
      [makeLanding(), makeLanding({ id: "landing-2" })],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.landingCount).toBe(2);
    expect(rows[0]?.status).toBe("Draft");
  });

  test("uses only persisted published landing state for the publication status", () => {
    const rows = buildLaunchSummaries(
      [makeOffer({ landing_url: "https://legacy.example" })],
      [makeLanding({ status: "published", published_url: "https://shop.example" })],
    );

    expect(rows[0]?.status).toBe("Published");
    expect(rows[0]?.publishedUrl).toBe("https://shop.example");
  });

  test("derives errors and readiness from existing landing records without inventing DB statuses", () => {
    const error = buildLaunchSummaries([makeOffer()], [makeLanding({ status: "error" })]);
    const ready = buildLaunchSummaries([makeOffer()], [makeLanding({ status: "ready" })]);

    expect(error[0]?.status).toBe("Error");
    expect(ready[0]?.status).toBe("Ready");
  });

  test("keeps an unpublished workflow address separate from a published URL", () => {
    const rows = buildLaunchSummaries(
      [makeOffer()],
      [],
      [
        {
          launchId: "launch-1",
          offerId: "offer-1",
          stage: "adapter_prepared",
          lastErrorCode: null,
          url: null,
          isProcessing: false,
          hostId: "host-1",
          hostname: "shop.example",
        },
      ],
    );

    expect(rows[0]?.status).toBe("Ready");
    expect(rows[0]?.hostname).toBe("shop.example");
    expect(rows[0]?.publishedUrl).toBeNull();
  });

  test("shows a saved workflow URL only after its published stage", () => {
    const rows = buildLaunchSummaries(
      [makeOffer()],
      [],
      [
        {
          launchId: "launch-1",
          offerId: "offer-1",
          stage: "published",
          lastErrorCode: null,
          url: "https://shop.example",
          isProcessing: false,
          hostId: "host-1",
          hostname: "shop.example",
        },
      ],
    );

    expect(rows[0]?.status).toBe("Published");
    expect(rows[0]?.publishedUrl).toBe("https://shop.example");
  });
});
