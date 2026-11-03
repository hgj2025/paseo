import type { Theme } from "./theme";
import { conversationBodyStyle, conversationInlineCodeSize } from "./conversation-typography";
import { isWeb } from "@/constants/platform";

const webSelectableTextStyle = isWeb ? { userSelect: "text" as const } : {};

const CONTENT_HEADING_SCALE = { "2xl": 1.2, xl: 1.1, lg: 1, base: 1 } as const;

function contentHeadingSize(contentSize: number, tier: keyof typeof CONTENT_HEADING_SCALE): number {
  return Math.round(contentSize * CONTENT_HEADING_SCALE[tier]);
}

function contentHeadingLineHeight(
  contentSize: number,
  tier: keyof typeof CONTENT_HEADING_SCALE,
): number {
  return Math.round(contentHeadingSize(contentSize, tier) * 1.55);
}

/**
 * Creates comprehensive markdown styles for react-native-markdown-display.
 *
 * Usage:
 *   const markdownStyles = useMemo(() => createMarkdownStyles(theme), [theme]);
 *   <Markdown style={markdownStyles} markdownit={parser}>{content}</Markdown>
 *
 * Always pass `markdownit` from `@/utils/markdown-parser`. Omit it and
 * react-native-markdown-display builds its own parser with `typographer: true`,
 * which rewrites a literal `(c)` as ©.
 */
export function createMarkdownStyles(theme: Theme) {
  return {
    // =========================================================================
    // BASE STYLES
    // =========================================================================

    body: {
      ...webSelectableTextStyle,
      color: theme.colors.foreground,
      ...conversationBodyStyle(theme),
      flexShrink: 1,
      minWidth: 0,
      width: "100%" as const,
    },

    text: {
      ...webSelectableTextStyle,
      flexShrink: 1,
      minWidth: 0,
      overflowWrap: "anywhere" as const,
    },

    paragraph: {
      marginTop: 0,
      marginBottom: theme.spacing[3],
      flexWrap: "wrap" as const,
      flexDirection: "row" as const,
      alignItems: "flex-start" as const,
      justifyContent: "flex-start" as const,
      flexShrink: 1,
      minWidth: 0,
      width: "100%" as const,
    },

    // =========================================================================
    // HEADINGS
    // =========================================================================

    heading1: {
      ...webSelectableTextStyle,
      fontSize: contentHeadingSize(theme.fontSize.content, "2xl"),
      fontWeight: theme.fontWeight.medium,
      color: theme.colors.foreground,
      marginTop: theme.spacing[6],
      marginBottom: theme.spacing[3],
      lineHeight: contentHeadingLineHeight(theme.fontSize.content, "2xl"),
    },

    heading2: {
      ...webSelectableTextStyle,
      fontSize: contentHeadingSize(theme.fontSize.content, "xl"),
      fontWeight: theme.fontWeight.medium,
      color: theme.colors.foreground,
      marginTop: theme.spacing[6],
      marginBottom: theme.spacing[3],
      lineHeight: contentHeadingLineHeight(theme.fontSize.content, "xl"),
    },

    heading3: {
      ...webSelectableTextStyle,
      fontSize: contentHeadingSize(theme.fontSize.content, "lg"),
      fontWeight: theme.fontWeight.medium,
      color: theme.colors.foreground,
      marginTop: theme.spacing[4],
      marginBottom: theme.spacing[2],
      lineHeight: contentHeadingLineHeight(theme.fontSize.content, "lg"),
    },

    heading4: {
      ...webSelectableTextStyle,
      fontSize: contentHeadingSize(theme.fontSize.content, "base"),
      fontWeight: theme.fontWeight.medium,
      color: theme.colors.foreground,
      marginTop: theme.spacing[4],
      marginBottom: theme.spacing[2],
      lineHeight: contentHeadingLineHeight(theme.fontSize.content, "base"),
    },

    heading5: {
      ...webSelectableTextStyle,
      fontSize: contentHeadingSize(theme.fontSize.content, "base"),
      fontWeight: theme.fontWeight.medium,
      color: theme.colors.foreground,
      marginTop: theme.spacing[3],
      marginBottom: theme.spacing[1],
      lineHeight: contentHeadingLineHeight(theme.fontSize.content, "base"),
    },

    heading6: {
      ...webSelectableTextStyle,
      fontSize: contentHeadingSize(theme.fontSize.content, "base"),
      fontWeight: theme.fontWeight.medium,
      color: theme.colors.foregroundMuted,
      marginTop: theme.spacing[3],
      marginBottom: theme.spacing[1],
      lineHeight: contentHeadingLineHeight(theme.fontSize.content, "base"),
    },

    // =========================================================================
    // TEXT FORMATTING
    // =========================================================================

    strong: {
      ...webSelectableTextStyle,
      fontWeight: theme.fontWeight.normal,
    },

    em: {
      ...webSelectableTextStyle,
      fontStyle: "italic" as const,
    },

    s: {
      ...webSelectableTextStyle,
      textDecorationLine: "line-through" as const,
      color: theme.colors.foregroundMuted,
    },

    link: {
      ...webSelectableTextStyle,
      color: theme.colors.accentBright,
      textDecorationLine: "none" as const,
      flexShrink: 1,
      minWidth: 0,
      overflowWrap: "anywhere" as const,
    },

    blocklink: {
      ...webSelectableTextStyle,
      color: theme.colors.accentBright,
      textDecorationLine: "none" as const,
      flexShrink: 1,
      minWidth: 0,
      overflowWrap: "anywhere" as const,
    },

    // =========================================================================
    // CODE
    // =========================================================================

    code_inline: {
      ...webSelectableTextStyle,
      backgroundColor: "transparent",
      fontWeight: theme.fontWeight.normal,
      color: theme.colors.foreground,
      paddingHorizontal: 0,
      paddingVertical: 0,
      borderRadius: 0,
      borderWidth: 0,
      fontFamily: theme.fontFamily.mono,
      fontSize: conversationInlineCodeSize(theme.fontSize.content),
    },

    code_block: {
      ...webSelectableTextStyle,
      backgroundColor: theme.colors.surface2,
      color: theme.colors.foreground,
      padding: theme.spacing[3],
      borderRadius: theme.borderRadius.md,
      fontFamily: theme.fontFamily.mono,
      fontSize: theme.fontSize.code,
      marginVertical: theme.spacing[2],
    },

    fence: {
      ...webSelectableTextStyle,
      backgroundColor: theme.colors.surface2,
      color: theme.colors.foreground,
      padding: theme.spacing[3],
      borderRadius: theme.borderRadius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      fontFamily: theme.fontFamily.mono,
      fontSize: theme.fontSize.code,
      marginVertical: theme.spacing[3],
    },

    pre: {
      marginVertical: theme.spacing[2],
    },

    // =========================================================================
    // TABLES
    // =========================================================================

    table: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.borderRadius.md,
      marginVertical: theme.spacing[3],
    },

    thead: {
      backgroundColor: "transparent",
    },

    tbody: {},

    th: {
      ...webSelectableTextStyle,
      padding: theme.spacing[2],
      borderBottomWidth: 1,
      borderRightWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: "transparent",
      fontWeight: theme.fontWeight.semibold,
      color: theme.colors.foreground,
      ...conversationBodyStyle(theme),
      textAlign: "left" as const,
    },

    tr: {
      borderBottomWidth: 1,
      borderColor: theme.colors.border,
      flexDirection: "row" as const,
    },

    td: {
      ...webSelectableTextStyle,
      padding: theme.spacing[2],
      borderRightWidth: 1,
      borderColor: theme.colors.border,
      color: theme.colors.foreground,
      ...conversationBodyStyle(theme),
      flex: 1,
    },

    // =========================================================================
    // LISTS
    // =========================================================================

    bullet_list: {
      paddingLeft: 0,
      width: "100%" as const,
    },

    ordered_list: {
      paddingLeft: 0,
      width: "100%" as const,
    },

    list_item: {
      marginBottom: theme.spacing[1],
      flexDirection: "row" as const,
      alignItems: "flex-start" as const,
      flexShrink: 1,
    },

    bullet_list_content: {
      flex: 1,
      flexShrink: 1,
    },

    ordered_list_content: {
      flex: 1,
      flexShrink: 1,
    },

    bullet_list_icon: {
      ...webSelectableTextStyle,
      color: theme.colors.foregroundMuted,
      marginRight: 4,
      fontSize: theme.fontSize.content,
      lineHeight: conversationBodyStyle(theme).lineHeight,
    },

    ordered_list_icon: {
      ...webSelectableTextStyle,
      color: theme.colors.foregroundMuted,
      marginRight: 4,
      fontSize: theme.fontSize.content,
      fontWeight: theme.fontWeight.normal,
      lineHeight: conversationBodyStyle(theme).lineHeight,
      minWidth: 12,
    },

    // =========================================================================
    // BLOCKQUOTE
    // =========================================================================

    blockquote: {
      backgroundColor: theme.colors.surface1,
      color: `${theme.colors.foreground}cc`,
      borderLeftWidth: 4,
      borderLeftColor: theme.colors.surface2,
      paddingHorizontal: theme.spacing[4],
      paddingTop: theme.spacing[3],
      paddingBottom: 0,
      marginVertical: theme.spacing[3],
      borderRadius: theme.borderRadius.md,
      borderTopLeftRadius: 0,
      borderBottomLeftRadius: 0,
    },

    // =========================================================================
    // HORIZONTAL RULE
    // =========================================================================

    hr: {
      backgroundColor: theme.colors.border,
      height: 1,
      marginVertical: 10,
    },

    // =========================================================================
    // IMAGES
    // =========================================================================

    image: {
      borderRadius: theme.borderRadius.md,
      marginVertical: theme.spacing[2],
    },

    // =========================================================================
    // BREAKS
    // =========================================================================

    hardbreak: {
      height: theme.spacing[2],
    },

    softbreak: {},
  };
}

/**
 * Creates a smaller variant of markdown styles for compact UI elements
 * like thought bubbles, tooltips, or side panels.
 */
export function createCompactMarkdownStyles(theme: Theme) {
  const baseStyles = createMarkdownStyles(theme);

  return {
    ...baseStyles,

    heading1: {
      ...baseStyles.heading1,
      fontSize: contentHeadingSize(theme.fontSize.content, "2xl"),
      marginTop: theme.spacing[4],
      marginBottom: theme.spacing[2],
      lineHeight: contentHeadingLineHeight(theme.fontSize.content, "2xl"),
    },

    heading2: {
      ...baseStyles.heading2,
      fontSize: contentHeadingSize(theme.fontSize.content, "xl"),
      marginTop: theme.spacing[3],
      marginBottom: theme.spacing[2],
      lineHeight: contentHeadingLineHeight(theme.fontSize.content, "xl"),
    },

    heading3: {
      ...baseStyles.heading3,
      fontSize: contentHeadingSize(theme.fontSize.content, "lg"),
      marginTop: theme.spacing[3],
      marginBottom: theme.spacing[1],
      lineHeight: contentHeadingLineHeight(theme.fontSize.content, "lg"),
    },

    paragraph: {
      ...baseStyles.paragraph,
      marginBottom: theme.spacing[2],
    },

    code_block: {
      ...baseStyles.code_block,
      fontSize: theme.fontSize.code,
      padding: theme.spacing[2],
    },

    fence: {
      ...baseStyles.fence,
      fontSize: theme.fontSize.code,
      padding: theme.spacing[2],
    },
  };
}
