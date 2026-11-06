import { describe, expect, test } from "bun:test";
import { hasSidebarPermission, isActiveSidebarRoute } from "../src/lib/navigation";

const canAccessAdministration = (permissions: Record<string, boolean>) =>
  permissions["members.read"] === true || permissions["permissions.read"] === true;

describe("sidebar navigation", () => {
  test("shows Domains and Pixels to users with landing read or manage permission", () => {
    expect(hasSidebarPermission("landing_pages.read", {}, canAccessAdministration)).toBe(false);
    expect(
      hasSidebarPermission(
        "landing_pages.read",
        { "landing_pages.read": true },
        canAccessAdministration,
      ),
    ).toBe(true);
    expect(
      hasSidebarPermission(
        "landing_pages.read",
        { "landing_pages.manage": true },
        canAccessAdministration,
      ),
    ).toBe(true);
  });

  test("shows Launches only when offer, product, and landing data can be read", () => {
    const complete = {
      "offers.read": true,
      "products.read": true,
      "landing_pages.read": true,
    };
    expect(hasSidebarPermission("launches", complete, canAccessAdministration)).toBe(true);
    expect(
      hasSidebarPermission(
        "launches",
        { ...complete, "products.read": false },
        canAccessAdministration,
      ),
    ).toBe(false);
  });

  test("maps old offer and landing routes to the active Launches item", () => {
    expect(isActiveSidebarRoute("/offers", "/launches")).toBe(true);
    expect(isActiveSidebarRoute("/landings/landing-1", "/launches")).toBe(true);
    expect(isActiveSidebarRoute("/launches/launch-1", "/launches")).toBe(true);
    expect(isActiveSidebarRoute("/launches-other", "/launches")).toBe(false);
  });

  test("keeps Domains and Pixels direct routes active independently", () => {
    expect(isActiveSidebarRoute("/domains/domain-1", "/domains")).toBe(true);
    expect(isActiveSidebarRoute("/pixels", "/pixels")).toBe(true);
    expect(isActiveSidebarRoute("/pixels-extra", "/pixels")).toBe(false);
  });
});
