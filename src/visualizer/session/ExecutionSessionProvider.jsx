import { useMemo, useReducer } from "react";

import { ExecutionSessionContext } from "./ExecutionSessionContext.js";
import { createInitialSession, sessionReducer } from "./session.js";

export function ExecutionSessionProvider({ initialState, children }) {
  const [state, dispatch] = useReducer(
    sessionReducer,
    initialState,
    (seed) => seed ?? createInitialSession(),
  );
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return (
    <ExecutionSessionContext.Provider value={value}>{children}</ExecutionSessionContext.Provider>
  );
}
