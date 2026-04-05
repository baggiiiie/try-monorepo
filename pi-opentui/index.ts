import {
  BoxRenderable,
  TextRenderable,
  createCliRenderer,
  vstyles,
} from "@opentui/core";

const colors = {
  bg: "#090909",
  panel: "#171717",
  footer: "#202020",
  accent: "#4a98ff",
  text: "#f1f1f1",
  muted: "#8b8b92",
  subtle: "#67676d",
  guide: "#262626",
  thinking: "#a68557",
  warning: "#f1ab3c",
  track: "#2f2f2f",
  thumb: "#5f5f5f",
};

const renderer = await createCliRenderer({
  backgroundColor: colors.bg,
  consoleMode: "disabled",
  exitOnCtrlC: true,
  screenMode: "main-screen",
  useMouse: true,
});

renderer.setTerminalTitle("OpenTUI mockup");

const box = (options: ConstructorParameters<typeof BoxRenderable>[1]) =>
  new BoxRenderable(renderer, options);

const text = (options: ConstructorParameters<typeof TextRenderable>[1]) =>
  new TextRenderable(renderer, options);

const spacer = (height = 1) =>
  box({
    height,
    shouldFill: false,
  });

const root = box({
  width: "100%",
  height: "100%",
  flexDirection: "column",
  backgroundColor: colors.bg,
  paddingTop: 1,
  paddingLeft: 1,
  paddingRight: 1,
  paddingBottom: 0,
  gap: 1,
});

const topPanel = box({
  width: "100%",
  height: 4,
  backgroundColor: colors.panel,
  flexDirection: "row",
  overflow: "hidden",
});

topPanel.add(
  box({
    width: 1,
    height: "100%",
    backgroundColor: colors.accent,
  }),
);

const topPanelInner = box({
  flexGrow: 1,
  justifyContent: "center",
  paddingLeft: 2,
  paddingRight: 2,
});

topPanelInner.add(
  text({
    content: "hi",
    fg: colors.text,
  }),
);

topPanel.add(topPanelInner);
root.add(topPanel);

const contentRow = box({
  width: "100%",
  flexGrow: 1,
  flexDirection: "row",
  minHeight: 0,
});

const conversationPane = box({
  flexGrow: 1,
  paddingTop: 1,
  paddingLeft: 1,
  paddingRight: 3,
});

const messageRow = box({
  flexDirection: "row",
  alignItems: "flex-start",
});

messageRow.add(
  box({
    width: 1,
    height: 2,
    backgroundColor: colors.guide,
    marginRight: 2,
  }),
);

const messageColumn = box({
  flexGrow: 1,
});

const thinkingText = text({
  width: "100%",
  wrapMode: "word",
});

thinkingText.add(vstyles.fg(colors.thinking, vstyles.italic("Thinking:")));
thinkingText.add(" ");
thinkingText.add(
  vstyles.fg(
    colors.muted,
    'The user is saying "hi" — a simple greeting. I should respond briefly and friendly.',
  ),
);
messageColumn.add(thinkingText);
messageColumn.add(spacer());
messageColumn.add(
  text({
    content: "Hi! How can I help you today?",
    fg: colors.text,
  }),
);
messageColumn.add(spacer());

const buildMeta = text({});
buildMeta.add(vstyles.fg(colors.accent, "□"));
buildMeta.add("  ");
buildMeta.add(vstyles.fg(colors.text, "Build"));
buildMeta.add(vstyles.fg(colors.subtle, " · qwen3.6-plus-free · 7.5s"));
messageColumn.add(buildMeta);

messageRow.add(messageColumn);
conversationPane.add(messageRow);
conversationPane.add(
  box({
    flexGrow: 1,
    shouldFill: false,
  }),
);

contentRow.add(conversationPane);

const scrollbar = box({
  width: 1,
  height: "100%",
  backgroundColor: colors.track,
  position: "relative",
  overflow: "hidden",
});

scrollbar.add(
  box({
    position: "absolute",
    top: 0,
    right: 0,
    width: 1,
    height: "82%",
    backgroundColor: colors.thumb,
  }),
);

contentRow.add(scrollbar);
root.add(contentRow);

const footer = box({
  width: "100%",
  height: 6,
  backgroundColor: colors.footer,
  flexDirection: "row",
  overflow: "hidden",
});

footer.add(
  box({
    width: 1,
    height: "100%",
    backgroundColor: colors.accent,
  }),
);

const footerInner = box({
  flexGrow: 1,
  paddingLeft: 2,
  paddingRight: 2,
  paddingBottom: 1,
});

footerInner.add(
  box({
    flexGrow: 1,
    shouldFill: false,
  }),
);

const statusLine = text({});
statusLine.add(vstyles.fg(colors.accent, "Build"));
statusLine.add("  ");
statusLine.add(vstyles.fg(colors.text, "Qwen3.6 Plus Free"));
statusLine.add(vstyles.fg(colors.subtle, " OpenCode Zen · "));
statusLine.add(vstyles.fg(colors.warning, "high"));
footerInner.add(statusLine);

footer.add(footerInner);
root.add(footer);

renderer.root.add(root);
renderer.requestRender();
