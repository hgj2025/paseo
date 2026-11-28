import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import type { ArchiveRule } from "./model";

const RuleSchema = z.strictObject({
  enabled: z.boolean(),
  olderThanDays: z.number().int().min(1).max(3650),
  provider: z.string(),
  directory: z.string(),
});
const ReportSchema = z.strictObject({
  at: z.number(),
  archived: z.number(),
  skipped: z.number(),
  failed: z.number(),
  error: z.string().nullable(),
});
const PersistedSchema = z.strictObject({
  rules: z.record(z.string(), RuleSchema),
  reports: z.record(z.string(), ReportSchema),
});
export type ArchiveReport = z.infer<typeof ReportSchema>;
interface State {
  rules: Record<string, ArchiveRule>;
  reports: Record<string, ArchiveReport>;
  setRule(serverId: string, rule: ArchiveRule): void;
  report(serverId: string, report: ArchiveReport): void;
}
export const useArchiveRules = create<State>()(
  persist(
    (set) => ({
      rules: {},
      reports: {},
      setRule: (serverId, rule) =>
        set((state) => ({
          rules: { ...state.rules, [serverId]: RuleSchema.parse(rule) },
        })),
      report: (serverId, report) =>
        set((state) => ({ reports: { ...state.reports, [serverId]: report } })),
    }),
    {
      name: "session-archive-rules-v1",
      storage: createValidatedPersistStorage(AsyncStorage, PersistedSchema),
      partialize: ({ rules, reports }) => ({ rules, reports }),
    },
  ),
);
