import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

const CoordinatorSchema = z.strictObject({
  serverId: z.string(),
  workspaceId: z.string(),
  agentId: z.string(),
});
export type WorkspaceCoordinator = z.infer<typeof CoordinatorSchema>;
const StateSchema = z.strictObject({ coordinators: z.record(z.string(), CoordinatorSchema) });
interface State {
  coordinators: Record<string, WorkspaceCoordinator>;
  setCoordinator(key: string, coordinator: WorkspaceCoordinator): void;
}
export const useWorkspaceCoordinationStore = create<State>()(
  persist(
    (set) => ({
      coordinators: {},
      setCoordinator: (key, coordinator) =>
        set((state) => ({ coordinators: { ...state.coordinators, [key]: coordinator } })),
    }),
    {
      name: "workspace-coordinators",
      storage: createValidatedPersistStorage(AsyncStorage, StateSchema),
      partialize: (state) => ({ coordinators: state.coordinators }),
    },
  ),
);
