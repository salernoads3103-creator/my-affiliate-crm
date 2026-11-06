export type AuthenticatedLandingRoute = "/dashboard" | "/workspace-setup";

export function getAuthenticatedWorkspacePath(workspaceCount: number): AuthenticatedLandingRoute {
  return workspaceCount > 0 ? "/dashboard" : "/workspace-setup";
}

export function shouldClearAuthScopedCache(event: string): boolean {
  return event === "SIGNED_IN" || event === "SIGNED_OUT";
}

export function getPasswordRecoveryRedirectUrl(origin: string): string {
  return new URL("/reset-password", origin).toString();
}
