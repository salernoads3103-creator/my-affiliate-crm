import { createContext } from "react";

export type WorkspaceSelection = {
  preferredWorkspaceId: string | null;
  setPreferredWorkspaceId: (workspaceId: string) => void;
};

export const WorkspaceSelectionContext = createContext<WorkspaceSelection>({
  preferredWorkspaceId: null,
  setPreferredWorkspaceId: () => {},
});
