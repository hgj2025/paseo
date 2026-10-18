import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { DensityIcon } from "@/components/ui/density-icon";
import { CircleAlert } from "lucide-react-native";
import { classifyModelLimit } from "./model-limit-state";

export function ModelLimitNotice({
  status,
  error,
  model,
}: {
  status: string;
  error?: string | null;
  model?: string | null;
}) {
  const { t } = useTranslation();
  const kind = status === "error" ? classifyModelLimit(error) : null;
  if (!kind) return null;
  return (
    <View accessibilityRole="alert" style={styles.notice} testID="model-limit-notice">
      <View style={styles.heading}>
        <DensityIcon icon={CircleAlert} size="sm" color="foregroundMuted" />
        <Text style={styles.title}>{t(`agentPanel.modelLimit.${kind}`)}</Text>
      </View>
      {model && (
        <Text style={styles.model} selectable>
          {model}
        </Text>
      )}
      <Text style={styles.description}>{t("agentPanel.modelLimit.description")}</Text>
      <Text style={styles.detail} selectable>
        {error}
      </Text>
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  notice: {
    marginHorizontal: theme.spacing[3],
    marginBottom: theme.spacing[2],
    padding: theme.spacing[3],
    gap: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.statusWarningTint,
  },
  heading: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  title: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.statusWarning,
  },
  model: { fontSize: theme.fontSize.sm, color: theme.colors.foreground },
  description: { fontSize: theme.fontSize.sm, lineHeight: 18, color: theme.colors.foreground },
  detail: { fontSize: theme.fontSize.sm, lineHeight: 18, color: theme.colors.foregroundMuted },
}));
