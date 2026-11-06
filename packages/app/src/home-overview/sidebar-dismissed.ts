import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

/** Local presentation preference only: never archive or interrupt a daemon session. */
export const useDismissedSessions = create<{
  day: string;
  hidden: string[];
  dismiss(day: string, key: string): void;
}>()(
  persist(
    (set) => ({
      day: "",
      hidden: [],
      dismiss: (day, key) =>
        set((state) => ({
          day,
          hidden: Array.from(new Set([...(state.day === day ? state.hidden : []), key])),
        })),
    }),
    {
      name: "today-session-dismissals",
      storage: createValidatedPersistStorage(
        AsyncStorage,
        z.object({ day: z.string(), hidden: z.array(z.string()) }),
      ),
      partialize: ({ day, hidden }) => ({ day, hidden }),
    },
  ),
);
