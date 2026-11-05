import AsyncStorage from "@react-native-async-storage/async-storage";
import { createStore } from "zustand/vanilla";
import { useSyncExternalStore } from "react";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

export const DEFAULT_ACTIVE_SESSION_HEIGHT = 300;
export function resolveActiveSessionHeight(requested: number, windowHeight: number) {
  const maximum = Math.max(144, windowHeight - 240);
  return Math.min(
    maximum,
    Math.max(144, Number.isFinite(requested) ? requested : DEFAULT_ACTIVE_SESSION_HEIGHT),
  );
}
export const activeSessionHeightStore = createStore<{
  height: number;
  setHeight(height: number): void;
}>()(
  persist(
    (set) => ({
      height: DEFAULT_ACTIVE_SESSION_HEIGHT,
      setHeight: (height) => {
        if (Number.isFinite(height)) set({ height });
      },
    }),
    {
      name: "active-session-sidebar-height",
      storage: createValidatedPersistStorage(
        AsyncStorage,
        z.object({ height: z.number().finite().positive() }),
      ),
      partialize: ({ height }) => ({ height }),
    },
  ),
);

export function useActiveSessionHeight<T>(
  selector: (state: ReturnType<typeof activeSessionHeightStore.getState>) => T,
): T {
  return useSyncExternalStore(
    activeSessionHeightStore.subscribe,
    () => selector(activeSessionHeightStore.getState()),
    () => selector(activeSessionHeightStore.getInitialState()),
  );
}
