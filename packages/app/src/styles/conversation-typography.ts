import type { Theme } from "./theme";

// Message prose keeps one reading rhythm across Markdown, user bubbles and team tasks.
export function conversationBodyStyle(theme: Theme) {
  return {
    fontSize: theme.fontSize.content,
    lineHeight: Math.round(theme.fontSize.content * 1.55),
  };
}

// Inline code belongs to the sentence; editor and fenced-code preferences stay independent.
export function conversationInlineCodeSize(contentSize: number) {
  return Math.round(contentSize * 0.93);
}
