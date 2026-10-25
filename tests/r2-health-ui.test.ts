import { describe, expect, it } from "bun:test";
import {
  canShowR2Diagnostics,
  R2_DIAGNOSTICS_RENDER_HOST,
} from "../src/lib/publications/health-ui";

describe("R2 diagnostics visibility", () => {
  it("shows the diagnostic action only on the DEV Render host for managers", () => {
    expect(canShowR2Diagnostics(R2_DIAGNOSTICS_RENDER_HOST, true)).toBe(true);
  });

  it("hides the diagnostic action on other hosts", () => {
    expect(canShowR2Diagnostics("crmonia.example.com", true)).toBe(false);
    expect(canShowR2Diagnostics("localhost", true)).toBe(false);
  });

  it("hides the diagnostic action without landing management permission", () => {
    expect(canShowR2Diagnostics(R2_DIAGNOSTICS_RENDER_HOST, false)).toBe(false);
  });
});
