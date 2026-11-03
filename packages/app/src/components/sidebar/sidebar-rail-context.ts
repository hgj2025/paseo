import { createContext } from "react";
/** App-owned presentation only; plugin contributions keep their existing navigation/runtime. */
export const SidebarRailContext = createContext(false);
