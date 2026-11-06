export type SidebarPermission =
  | "products.read"
  | "orders.read"
  | "landing_pages.read"
  | "launches"
  | "administration";

export function hasSidebarPermission(
  permission: SidebarPermission | undefined,
  permissions: Readonly<Record<string, boolean>>,
  canAccessAdministration: (permissions: Record<string, boolean>) => boolean,
): boolean {
  if (!permission) return true;
  if (permission === "administration") return canAccessAdministration(permissions);
  if (permission === "orders.read") {
    return permissions["orders.read"] === true || permissions["orders.manage"] === true;
  }
  if (permission === "landing_pages.read") {
    return (
      permissions["landing_pages.read"] === true || permissions["landing_pages.manage"] === true
    );
  }
  if (permission === "launches") {
    return (
      permissions["offers.read"] === true &&
      permissions["products.read"] === true &&
      (permissions["landing_pages.read"] === true || permissions["landing_pages.manage"] === true)
    );
  }
  return permissions[permission] === true;
}

function matchesRoute(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

/** Old offer and landing routes remain part of the combined Launches section. */
export function isActiveSidebarRoute(pathname: string, route: string): boolean {
  if (matchesRoute(pathname, route)) return true;
  return (
    route === "/launches" &&
    ["/offers", "/landings"].some((legacy) => matchesRoute(pathname, legacy))
  );
}
