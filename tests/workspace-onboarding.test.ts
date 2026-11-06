import { describe, expect, it } from "bun:test";

import {
  handleCreateWorkspaceRequest,
  parseWorkspaceName,
} from "@/lib/access/workspace-onboarding.server";
import { AccessApiError, type AccessContext } from "@/lib/access/access.server";
import {
  getAuthenticatedWorkspacePath,
  getPasswordRecoveryRedirectUrl,
  shouldClearAuthScopedCache,
} from "@/lib/auth/auth-flow";
import { resolveActiveWorkspaceId } from "@/lib/workspace-selection";

describe("workspace onboarding", () => {
  it("normalizes and validates workspace names at the API boundary", () => {
    expect(parseWorkspaceName("  Shop team  ")).toBe("Shop team");
    expect(() => parseWorkspaceName(" ")).toThrow(
      "Workspace name must be between 2 and 100 characters",
    );
    expect(() => parseWorkspaceName("bad\nname")).toThrow(
      "Workspace name must be between 2 and 100 characters",
    );
    expect(() => parseWorkspaceName("x".repeat(101))).toThrow(
      "Workspace name must be between 2 and 100 characters",
    );
  });

  it("passes only the validated name to the authenticated workspace RPC", async () => {
    let receivedName = "";
    const request = new Request("https://crm.example/api/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "  Independent buyer  ",
        workspaceId: "main",
        role: "super_admin",
        userId: "someone-else",
      }),
    });
    const response = await handleCreateWorkspaceRequest(request, async () => {
      const client = {
        rpc: async (_functionName: string, args: { p_name: string }) => {
          receivedName = args.p_name;
          return { data: "e1111111-1111-4111-8111-111111111101", error: null };
        },
      };
      return { client } as unknown as AccessContext;
    });

    expect(receivedName).toBe("Independent buyer");
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      success: true,
      data: { id: "e1111111-1111-4111-8111-111111111101" },
    });
  });

  it("requires authentication before calling the workspace RPC", async () => {
    const request = new Request("https://crm.example/api/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "My workspace" }),
    });
    const response = await handleCreateWorkspaceRequest(request, async () => {
      throw new AccessApiError(401, "Unauthorized");
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ success: false });
  });

  it("does not expose database details when creation fails", async () => {
    const request = new Request("https://crm.example/api/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "My workspace" }),
    });
    const response = await handleCreateWorkspaceRequest(request, async () => {
      const client = {
        rpc: async () => ({
          data: null,
          error: { code: "42501", message: "sensitive database detail" },
        }),
      };
      return { client } as unknown as AccessContext;
    });
    const body = await response.json();
    expect(response.status).toBe(403);
    expect(JSON.stringify(body)).not.toContain("sensitive database detail");
  });
});

describe("active workspace selection", () => {
  const workspaces = [{ id: "own" }, { id: "invited" }];

  it("restores a saved workspace only when it belongs to the authenticated workspace list", () => {
    expect(resolveActiveWorkspaceId(workspaces, "invited")).toBe("invited");
    expect(resolveActiveWorkspaceId(workspaces, "foreign-workspace")).toBe("own");
  });

  it("uses the first authorized workspace as a safe fallback", () => {
    expect(resolveActiveWorkspaceId(workspaces, null)).toBe("own");
    expect(resolveActiveWorkspaceId([], "stale-id")).toBeNull();
  });
});

describe("authentication navigation", () => {
  it("routes authenticated users with no workspace to onboarding", () => {
    expect(getAuthenticatedWorkspacePath(0)).toBe("/workspace-setup");
    expect(getAuthenticatedWorkspacePath(1)).toBe("/dashboard");
  });

  it("sends password recovery back to the dedicated reset route", () => {
    expect(getPasswordRecoveryRedirectUrl("https://crm.example")).toBe(
      "https://crm.example/reset-password",
    );
  });

  it("clears private query cache when the authenticated identity changes", () => {
    expect(shouldClearAuthScopedCache("SIGNED_IN")).toBe(true);
    expect(shouldClearAuthScopedCache("SIGNED_OUT")).toBe(true);
    expect(shouldClearAuthScopedCache("USER_UPDATED")).toBe(false);
  });
});
