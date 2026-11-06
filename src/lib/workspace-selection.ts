export type WorkspaceIdentity = { id: string };

export const ACTIVE_WORKSPACE_STORAGE_KEY = "crmonia.active-workspace";

export function resolveActiveWorkspaceId(
  workspaces: readonly WorkspaceIdentity[],
  preferredId: string | null,
): string | null {
  if (preferredId && workspaces.some((workspace) => workspace.id === preferredId)) {
    return preferredId;
  }
  return workspaces[0]?.id ?? null;
}

export function readPreferredWorkspaceId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function persistActiveWorkspaceId(workspaceId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, workspaceId);
  } catch {
    // The selection still applies for this session if browser storage is unavailable.
  }
}
