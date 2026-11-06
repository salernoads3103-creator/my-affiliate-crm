import { useCallback, useState, type ReactNode } from "react";
import { persistActiveWorkspaceId, readPreferredWorkspaceId } from "@/lib/workspace-selection";
import { WorkspaceSelectionContext } from "./workspace-selection-context";

export function WorkspaceSelectionProvider({ children }: { children: ReactNode }) {
  const [preferredWorkspaceId, setPreferredWorkspaceIdState] = useState<string | null>(
    readPreferredWorkspaceId,
  );

  const setPreferredWorkspaceId = useCallback((workspaceId: string) => {
    setPreferredWorkspaceIdState(workspaceId);
    persistActiveWorkspaceId(workspaceId);
  }, []);

  return (
    <WorkspaceSelectionContext.Provider value={{ preferredWorkspaceId, setPreferredWorkspaceId }}>
      {children}
    </WorkspaceSelectionContext.Provider>
  );
}
