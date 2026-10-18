import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

const RecipientSchema = z.object({
  // COMPAT(team-recipient): added in v0.11.2 private build; remove after 2027-04-17.
  // Retain the former single recipient when restoring a saved draft.
  inline: z.boolean().optional(),
  memberId: z.string().optional(),
  memberIds: z.array(z.string()).optional(),
  mode: z.enum(["coordinate", "broadcast"]).optional(),
  taskId: z.string().nullable(),
  prompt: z.string().nullable(),
});
export type TeamRecipient = z.infer<typeof RecipientSchema>;
interface State {
  recipients: Record<string, TeamRecipient>;
  collapsed: Record<string, boolean>;
  setCollapsed(key: string, value: boolean): void;
  set(key: string, recipient: TeamRecipient | null): void;
}
export const useTeamComposerStore = create<State>()(
  persist(
    (set) => ({
      recipients: {},
      collapsed: {},
      setCollapsed: (key, value) =>
        set((state) => ({ collapsed: { ...state.collapsed, [key]: value } })),
      set: (key, recipient) =>
        set((state) => {
          const recipients = { ...state.recipients };
          if (recipient) recipients[key] = recipient;
          else delete recipients[key];
          return { recipients };
        }),
    }),
    {
      name: "team-composer-recipients",
      storage: createValidatedPersistStorage(
        AsyncStorage,
        z.object({
          recipients: z.record(z.string(), RecipientSchema),
          collapsed: z.record(z.string(), z.boolean()).default({}),
        }),
      ),
      partialize: (state) => ({ recipients: state.recipients, collapsed: state.collapsed }),
    },
  ),
);

export function recipientIds(recipient: TeamRecipient | undefined): string[] {
  return recipient?.memberIds ?? (recipient?.memberId ? [recipient.memberId] : []);
}
