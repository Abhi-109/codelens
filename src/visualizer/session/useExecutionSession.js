import { useContext } from "react";

import { ExecutionSessionContext } from "./ExecutionSessionContext.js";

export function useExecutionSession() {
  const value = useContext(ExecutionSessionContext);
  if (!value) {
    throw new Error("useExecutionSession must be used inside ExecutionSessionProvider");
  }
  return value;
}
