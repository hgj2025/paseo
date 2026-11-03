import { describe, expect, it } from "vitest";
import { createCompactMarkdownStyles, createMarkdownStyles } from "./markdown-styles";
import { darkTheme } from "./theme";

describe("createMarkdownStyles", () => {
  it("keeps prose emphasis and inline code visually quiet", () => {
    const styles = createMarkdownStyles(darkTheme);
    expect(styles.strong.fontWeight).toBe(darkTheme.fontWeight.normal);
    expect(styles.heading1.fontWeight).toBe(darkTheme.fontWeight.medium);
    expect(styles.code_inline).toMatchObject({
      backgroundColor: "transparent",
      fontWeight: darkTheme.fontWeight.normal,
      paddingHorizontal: 0,
      borderWidth: 0,
    });
  });

  it("uses the content size for conversation prose and list markers", () => {
    const styles = createMarkdownStyles(darkTheme);
    const proseLineHeight = Math.round(darkTheme.fontSize.content * 1.55);

    expect(styles.body).toMatchObject({
      fontSize: darkTheme.fontSize.content,
      lineHeight: proseLineHeight,
    });
    expect(styles.bullet_list_icon).toMatchObject({
      fontSize: darkTheme.fontSize.content,
      lineHeight: proseLineHeight,
    });
    expect(styles.ordered_list_icon).toMatchObject({
      fontSize: darkTheme.fontSize.content,
      lineHeight: proseLineHeight,
    });
  });

  it("applies shrink-and-wrap constraints to long markdown text and links", () => {
    const styles = createMarkdownStyles(darkTheme);

    expect(styles.body).toMatchObject({
      flexShrink: 1,
      minWidth: 0,
      width: "100%",
    });

    expect(styles.paragraph).toMatchObject({
      flexShrink: 1,
      minWidth: 0,
      width: "100%",
      flexWrap: "wrap",
    });

    expect(styles.text).toMatchObject({
      flexShrink: 1,
      minWidth: 0,
      overflowWrap: "anywhere",
    });

    expect(styles.link).toMatchObject({
      flexShrink: 1,
      minWidth: 0,
      overflowWrap: "anywhere",
    });

    expect(styles.blocklink).toMatchObject({
      flexShrink: 1,
      minWidth: 0,
      overflowWrap: "anywhere",
    });
  });

  it("keeps assistant markdown text selectable on web", () => {
    const styles = createMarkdownStyles(darkTheme);

    expect(styles.body).toMatchObject({
      userSelect: "text",
    });
    expect(styles.text).toMatchObject({
      userSelect: "text",
    });
    expect(styles.heading1).toMatchObject({
      userSelect: "text",
    });
    expect(styles.link).toMatchObject({
      userSelect: "text",
    });
    expect(styles.code_inline).toMatchObject({
      userSelect: "text",
    });
    expect(styles.code_block).toMatchObject({
      userSelect: "text",
    });
    expect(styles.fence).toMatchObject({
      userSelect: "text",
    });
    expect(styles.bullet_list_icon).toMatchObject({
      userSelect: "text",
    });
    expect(styles.ordered_list_icon).toMatchObject({
      userSelect: "text",
    });
  });

  it("keeps inline code on the reading scale and block code on the code scale", () => {
    const styles = createMarkdownStyles(darkTheme);
    const compactStyles = createCompactMarkdownStyles(darkTheme);

    expect(styles.code_inline).toMatchObject({
      fontFamily: darkTheme.fontFamily.mono,
      fontSize: 14,
    });
    expect(styles.code_inline).not.toHaveProperty("lineHeight");
    expect(styles.code_block).toMatchObject({
      fontFamily: darkTheme.fontFamily.mono,
      fontSize: darkTheme.fontSize.code,
    });
    expect(styles.fence).toMatchObject({
      fontFamily: darkTheme.fontFamily.mono,
      fontSize: darkTheme.fontSize.code,
    });
    expect(compactStyles.code_inline).toMatchObject({
      fontFamily: darkTheme.fontFamily.mono,
      fontSize: 14,
    });
    expect(compactStyles.code_inline).not.toHaveProperty("lineHeight");
  });

  it("keeps the reading scale independent of editor size and consistent across tables", () => {
    const theme = { ...darkTheme, fontSize: { ...darkTheme.fontSize, content: 21, code: 10 } };
    const styles = createMarkdownStyles(theme);
    const compact = createCompactMarkdownStyles(theme);
    expect(styles.body).toMatchObject({ fontSize: 21, lineHeight: 33 });
    expect(styles.th).toMatchObject({ fontSize: 21, lineHeight: 33 });
    expect(styles.td).toMatchObject({ fontSize: 21, lineHeight: 33 });
    expect(styles.code_inline.fontSize).toBe(20);
    expect(compact.code_inline.fontSize).toBe(20);
    expect(styles.fence.fontSize).toBe(10);
    expect(styles.heading1.fontSize).toBeLessThanOrEqual(21 * 1.25);
    expect(styles.heading3.fontSize).toBe(21);
  });

  it("scales Markdown headings from content size with safe line heights", () => {
    const largeContentTheme = {
      ...darkTheme,
      fontSize: { ...darkTheme.fontSize, content: 21 },
    };
    const styles = createMarkdownStyles(largeContentTheme);

    expect(styles.heading1.lineHeight).toBeGreaterThan(styles.heading1.fontSize);
    expect(styles.heading2.lineHeight).toBeGreaterThan(styles.heading2.fontSize);
    expect(styles.heading3.lineHeight).toBeGreaterThan(styles.heading3.fontSize);
  });

  it("keeps blockquotes quiet with a square left edge", () => {
    const styles = createMarkdownStyles(darkTheme);

    expect(styles.blockquote).toMatchObject({
      backgroundColor: darkTheme.colors.surface1,
      color: `${darkTheme.colors.foreground}cc`,
      borderLeftColor: darkTheme.colors.surface2,
      paddingTop: darkTheme.spacing[3],
      paddingBottom: 0,
      borderTopLeftRadius: 0,
      borderBottomLeftRadius: 0,
    });
    expect(styles.paragraph.marginBottom).toBe(darkTheme.spacing[3]);
    expect(styles.text).not.toHaveProperty("color");
  });
});
