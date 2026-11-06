import { useContext } from "react";
import { WorkspaceSelectionContext } from "@/components/workspace/workspace-selection-context";

export function useWorkspaceSelection() {
  return useContext(WorkspaceSelectionContext);
}
