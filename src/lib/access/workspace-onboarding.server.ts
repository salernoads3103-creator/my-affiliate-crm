import {
  accessErrorResponse,
  accessSuccessResponse,
  AccessApiError,
  mapRpcError,
  readJsonBody,
  requireAccessContext,
  type AccessContext,
} from "./access.server";

type WorkspaceCreateRpcResult = {
  data: string | null;
  error: { code?: string | null; message?: string | null } | null;
};

type AccessContextResolver = (request: Request) => Promise<AccessContext>;

export function parseWorkspaceName(value: unknown): string {
  if (typeof value !== "string") {
    throw new AccessApiError(400, "Enter a workspace name", "VALIDATION_ERROR");
  }
  const name = value.trim();
  const length = [...name].length;
  if (length < 2 || length > 100 || /\p{Cc}/u.test(name)) {
    throw new AccessApiError(
      400,
      "Workspace name must be between 2 and 100 characters",
      "VALIDATION_ERROR",
    );
  }
  return name;
}

async function createWorkspaceWithRpc(
  value: unknown,
  invoke: (name: string) => Promise<WorkspaceCreateRpcResult>,
): Promise<{ id: string }> {
  const name = parseWorkspaceName(value);
  const { data, error } = await invoke(name);
  if (error) throw mapRpcError(error.code ?? undefined, error.message ?? undefined, error);
  if (!data || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data)) {
    throw new AccessApiError(500, "Workspace creation could not be confirmed", "INTERNAL_ERROR");
  }
  return { id: data };
}

export async function handleCreateWorkspaceRequest(
  request: Request,
  resolveContext: AccessContextResolver = requireAccessContext,
): Promise<Response> {
  try {
    const { client } = await resolveContext(request);
    const body = await readJsonBody(request);
    const result = await createWorkspaceWithRpc(body.name, async (name) => {
      const { data, error } = await client.rpc("create_workspace_for_current_user", {
        p_name: name,
      });
      return { data, error };
    });
    return accessSuccessResponse(result, 201);
  } catch (error) {
    return accessErrorResponse(error);
  }
}
