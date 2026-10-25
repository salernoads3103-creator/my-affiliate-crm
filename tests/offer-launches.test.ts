import { describe, expect, test } from "bun:test";
import { ApiError } from "../src/lib/api-error";
import {
  continueOfferLaunch,
  launchRequestFingerprint,
  type OfferLaunchState,
  type OfferLaunchWorkflowPort,
} from "../src/lib/offer-launches/workflow";

function setup() {
  let state: OfferLaunchState = {
    id: "10000000-0000-4000-8000-000000000001",
    workspace_id: "20000000-0000-4000-8000-000000000001",
    offer_id: "30000000-0000-4000-8000-000000000001",
    offer_name: "Test offer",
    product_id: "40000000-0000-4000-8000-000000000001",
    domain_host_id: "50000000-0000-4000-8000-000000000001",
    stage: "offer_created",
    publication_attempt: 0,
    publication_version_id: null,
    published_url: null,
    last_error_code: null,
  };
  const calls = { landing: 0, changedHost: 0, reserve: 0, adapter: 0, publish: 0 };
  let failReserve = false;
  let failPublishOnce = false;
  const port: OfferLaunchWorkflowPort = {
    get: async () => state,
    ensureLanding: async () => {
      calls.landing += 1;
    },
    changeHostname: async (_launch, hostId) => {
      calls.changedHost += 1;
      state = { ...state, domain_host_id: hostId };
    },
    reserveHostname: async () => {
      calls.reserve += 1;
      if (failReserve) {
        failReserve = false;
        throw new ApiError(409, "conflict", "CONFLICT");
      }
    },
    prepareAdapter: async () => {
      calls.adapter += 1;
      return "prepared";
    },
    publish: async () => {
      calls.publish += 1;
      if (failPublishOnce) {
        failPublishOnce = false;
        throw new ApiError(502, "upstream timeout", "INTERNAL_ERROR");
      }
      return { versionId: "60000000-0000-4000-8000-000000000001", url: "https://shop.example" };
    },
    advance: async (_launch, stage) => {
      state = { ...state, stage, last_error_code: null };
    },
    complete: async (_launch, publication) => {
      state = {
        ...state,
        stage: "published",
        publication_version_id: publication.versionId,
        published_url: publication.url,
        last_error_code: null,
      };
    },
    recordError: async (_launch, code) => {
      state = { ...state, last_error_code: code };
    },
    hostname: async () => "shop.example",
  };
  return {
    calls,
    port,
    state: () => state,
    failReserve: () => {
      failReserve = true;
    },
    failPublishOnce: () => {
      failPublishOnce = true;
    },
  };
}

describe("offer launch recovery", () => {
  test("the idempotency fingerprint includes stable tracking values and is reproducible", async () => {
    const input = {
      workspaceId: "20000000-0000-4000-8000-000000000001",
      productId: "40000000-0000-4000-8000-000000000001",
      offerName: "Test offer",
      offerPriceMinor: 119000,
      sourceArchiveSha256: "a".repeat(64),
      tracking: {
        tiktokProfileId: "70000000-0000-4000-8000-000000000001",
        tiktokPixelId: "pixel-1",
        googleAdsProfileId: null,
        googleAdsConversionId: null,
        googleAdsConversionLabel: null,
      },
    };
    const first = await launchRequestFingerprint(input);
    expect(await launchRequestFingerprint(input)).toBe(first);
    expect(
      await launchRequestFingerprint({
        ...input,
        tracking: { ...input.tracking, tiktokPixelId: "pixel-2" },
      }),
    ).not.toBe(first);
  });

  test("a repeated request after publication returns the same result without creating duplicates", async () => {
    const fixture = setup();
    const first = await continueOfferLaunch(
      fixture.state().workspace_id,
      fixture.state().id,
      fixture.port,
    );
    const second = await continueOfferLaunch(
      fixture.state().workspace_id,
      fixture.state().id,
      fixture.port,
    );

    expect(second).toEqual(first);
    expect(fixture.calls).toEqual({
      landing: 1,
      changedHost: 0,
      reserve: 1,
      adapter: 1,
      publish: 1,
    });
  });

  test("a partially completed launch resumes without recreating its landing", async () => {
    const fixture = setup();
    fixture.failReserve();
    await expect(
      continueOfferLaunch(fixture.state().workspace_id, fixture.state().id, fixture.port),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(fixture.state().stage).toBe("landing_created");

    await continueOfferLaunch(fixture.state().workspace_id, fixture.state().id, fixture.port);
    expect(fixture.calls.landing).toBe(1);
    expect(fixture.state().stage).toBe("published");
  });

  test("a conflicting hostname can be replaced before adapter preparation", async () => {
    const fixture = setup();
    fixture.failReserve();
    await expect(
      continueOfferLaunch(fixture.state().workspace_id, fixture.state().id, fixture.port),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const replacement = "50000000-0000-4000-8000-000000000002";
    const result = await continueOfferLaunch(
      fixture.state().workspace_id,
      fixture.state().id,
      fixture.port,
      replacement,
    );
    expect(fixture.state().domain_host_id).toBe(replacement);
    expect(fixture.calls.changedHost).toBe(1);
    expect(result.url).toBe("https://shop.example");
  });

  test("an uncertain publication failure retries from the prepared stage", async () => {
    const fixture = setup();
    fixture.failPublishOnce();
    await expect(
      continueOfferLaunch(fixture.state().workspace_id, fixture.state().id, fixture.port),
    ).rejects.toMatchObject({ status: 502 });
    expect(fixture.state().stage).toBe("adapter_prepared");
    expect(fixture.state().last_error_code).toBe("PUBLICATION_FAILED");

    const result = await continueOfferLaunch(
      fixture.state().workspace_id,
      fixture.state().id,
      fixture.port,
    );
    expect(result.url).toBe("https://shop.example");
    expect(fixture.calls.adapter).toBe(1);
    expect(fixture.calls.publish).toBe(2);
  });

  test("a blocked adapter never reaches publication", async () => {
    const fixture = setup();
    fixture.port.prepareAdapter = async () => {
      fixture.calls.adapter += 1;
      return { blocked: "LANDING_ADAPTATION_REQUIRED" };
    };
    await expect(
      continueOfferLaunch(fixture.state().workspace_id, fixture.state().id, fixture.port),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(fixture.calls.publish).toBe(0);
    expect(fixture.state().last_error_code).toBe("LANDING_ADAPTATION_REQUIRED");
    expect(fixture.state().published_url).toBeNull();
  });

  test("an unavailable source archive is recorded and does not create a publication", async () => {
    const fixture = setup();
    fixture.port.ensureLanding = async () => {
      fixture.calls.landing += 1;
      throw new ApiError(500, "storage unavailable", "INTERNAL_ERROR");
    };
    await expect(
      continueOfferLaunch(fixture.state().workspace_id, fixture.state().id, fixture.port),
    ).rejects.toMatchObject({ status: 500 });
    expect(fixture.state().last_error_code).toBe("LANDING_ARCHIVE_UNAVAILABLE");
    expect(fixture.calls.publish).toBe(0);
    expect(fixture.state().published_url).toBeNull();
  });

  test("missing Intake API configuration is distinguished from an invalid ZIP", async () => {
    const fixture = setup();
    fixture.port.prepareAdapter = async () => {
      fixture.calls.adapter += 1;
      return { blocked: "INTAKE_API_NOT_CONFIGURED" };
    };
    await expect(
      continueOfferLaunch(fixture.state().workspace_id, fixture.state().id, fixture.port),
    ).rejects.toMatchObject({ status: 409 });
    expect(fixture.state().last_error_code).toBe("INTAKE_API_NOT_CONFIGURED");
    expect(fixture.calls.publish).toBe(0);
  });
});
