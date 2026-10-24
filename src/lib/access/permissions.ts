export const WORKSPACE_PERMISSIONS = [
  "workspace.read",
  "members.read",
  "members.invite",
  "members.manage_roles",
  "members.assign_admin",
  "permissions.read",
  "permissions.manage",
  "leads.read",
  "leads.create",
  "leads.update",
  "leads.delete",
  "leads.assign",
  "leads.assign_team",
  "leads.assign_offer",
  "teams.read",
  "teams.manage",
  "offers.read",
  "offers.manage",
  "orders.read",
  "orders.manage",
  "shipping.manage",
  "landing_pages.read",
  "landing_pages.manage",
  "products.read",
  "products.manage",
  "products.cost.read",
  "audit.read",
] as const;

export type WorkspacePermission = (typeof WORKSPACE_PERMISSIONS)[number];
export type WorkspaceRole = "super_admin" | "admin" | "operator" | "viewer";
export type WorkspaceScope = "workspace" | "team" | "operator" | "offer";
