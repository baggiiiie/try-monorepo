import {
  BoxRenderable,
  ScrollBoxRenderable,
  TextRenderable,
  TextareaRenderable,
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

const composerBorderChars = {
  topLeft: " ",
  topRight: " ",
  bottomLeft: "╹",
  bottomRight: " ",
  horizontal: "▀",
  vertical: "┃",
  topT: " ",
  bottomT: " ",
  leftT: " ",
  rightT: " ",
  cross: " ",
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

const textarea = (options: ConstructorParameters<typeof TextareaRenderable>[1]) =>
  new TextareaRenderable(renderer, options);

const spacer = (height = 1) =>
  box({
    height,
    shouldFill: false,
  });

const userPrompt = (content: string) => {
  const wrapper = box({
    width: "100%",
    height: 3,
    backgroundColor: colors.panel,
    border: ["left"],
    borderColor: colors.accent,
    customBorderChars: composerBorderChars,
    paddingLeft: 2,
    justifyContent: "center",
  });

  wrapper.add(
    text({
      width: "100%",
      content,
      fg: colors.text,
      wrapMode: "none",
      truncate: true,
    }),
  );

  return wrapper;
};

const thinkingBlock = (content: string) => {
  const wrapper = box({
    width: "100%",
    border: ["left"],
    borderColor: colors.guide,
    customBorderChars: composerBorderChars,
    paddingLeft: 2,
  });

  const line = text({
    width: "100%",
    fg: colors.muted,
    wrapMode: "word",
  });

  line.add(vstyles.fg(colors.thinking, vstyles.italic("Thinking:")));
  line.add(" ");
  line.add(vstyles.fg(colors.muted, content));
  wrapper.add(line);

  return wrapper;
};

const assistantReply = (content: string) =>
  text({
    width: "100%",
    marginLeft: 3,
    content,
    fg: colors.text,
    wrapMode: "word",
  });

const buildLine = (duration: string) => {
  const line = text({
    width: "100%",
    marginLeft: 3,
    wrapMode: "none",
    truncate: true,
  });

  line.add(vstyles.fg(colors.accent, "▣"));
  line.add("  ");
  line.add(vstyles.fg(colors.text, "Build"));
  line.add(vstyles.fg(colors.subtle, ` · Big Pickle · ${duration}`));

  return line;
};

const transcriptContent = box({
  width: "100%",
  paddingLeft: 2,
  paddingRight: 2,
  paddingTop: 1,
});

transcriptContent.add(userPrompt("hi"));
transcriptContent.add(spacer());
transcriptContent.add(
  thinkingBlock('The user is just saying "hi" - a simple greeting. I should respond concisely and briefly.'),
);
transcriptContent.add(spacer());
transcriptContent.add(assistantReply("Hi! How can I help you today?"));
transcriptContent.add(spacer());
transcriptContent.add(buildLine("4.2s"));
transcriptContent.add(spacer());
transcriptContent.add(userPrompt("im just writing text to demo openTUI"));
transcriptContent.add(spacer());
transcriptContent.add(
  thinkingBlock(
    "The user is just casually testing/demoing the openTUI application. This seems like a simple interaction, so I should respond briefly and naturally.",
  ),
);
transcriptContent.add(spacer());
transcriptContent.add(
  assistantReply("Got it! Let me know if you need help with anything specific."),
);
transcriptContent.add(spacer());
transcriptContent.add(buildLine("2.6s"));
transcriptContent.add(spacer(7));

const transcript = new ScrollBoxRenderable(renderer, {
  flexGrow: 1,
  height: "100%",
  backgroundColor: colors.bg,
  rootOptions: {
    backgroundColor: colors.bg,
  },
  wrapperOptions: {
    backgroundColor: colors.bg,
  },
  viewportOptions: {
    backgroundColor: colors.bg,
  },
  contentOptions: {
    backgroundColor: colors.bg,
  },
  verticalScrollbarOptions: {
    showArrows: false,
    trackOptions: {
      backgroundColor: colors.track,
      foregroundColor: colors.thumb,
    },
  },
  scrollY: true,
  scrollX: false,
});
transcript.verticalScrollBar.visible = false;

const rightRail = text({
  width: 1,
  height: "100%",
  fg: colors.thumb,
  content: Array.from({ length: 256 }, () => "█").join("\n"),
  wrapMode: "none",
  truncate: true,
});

transcript.add(transcriptContent);

const root = box({
  width: "100%",
  height: "100%",
  flexDirection: "column",
  backgroundColor: colors.bg,
});

const transcriptArea = box({
  width: "100%",
  flexGrow: 1,
  minHeight: 0,
  flexDirection: "row",
});
transcriptArea.add(transcript);
transcriptArea.add(rightRail);
transcriptArea.add(
  box({
    width: 2,
    height: "100%",
    backgroundColor: colors.bg,
  }),
);
root.add(transcriptArea);
root.add(spacer());

const bottomArea = box({
  width: "100%",
  height: 7,
  flexDirection: "column",
  backgroundColor: colors.bg,
  paddingLeft: 2,
  paddingRight: 2,
});

const composerShell = box({
  width: "100%",
  height: 4,
  backgroundColor: colors.footer,
  border: ["left"],
  borderColor: colors.accent,
  customBorderChars: composerBorderChars,
  flexDirection: "column",
  paddingLeft: 2,
  paddingRight: 1,
  paddingTop: 0,
  paddingBottom: 0,
});

const composer = textarea({
  width: "100%",
  height: 3,
  backgroundColor: colors.footer,
  focusedBackgroundColor: colors.footer,
  textColor: colors.text,
  focusedTextColor: colors.text,
  placeholder: "",
  cursorColor: colors.accent,
  wrapMode: "word",
});
composerShell.add(composer);

const statusRow = text({
  width: "100%",
  wrapMode: "none",
  truncate: true,
});
statusRow.add(vstyles.fg(colors.accent, "Build"));
statusRow.add("  ");
statusRow.add(vstyles.fg(colors.text, "Big Pickle"));
statusRow.add(vstyles.fg(colors.subtle, " OpenCode Zen"));
composerShell.add(statusRow);

bottomArea.add(composerShell);

bottomArea.add(
  text({
    width: "100%",
    content: `╹${"▀".repeat(400)}`,
    fg: colors.subtle,
    wrapMode: "none",
  }),
);

const helpRow = box({
  width: "100%",
  height: 1,
  flexDirection: "row",
  justifyContent: "flex-end",
});
helpRow.add(
  text({
    content: "11.3K (6%)  ctrl+p commands",
    fg: colors.muted,
    wrapMode: "none",
    truncate: true,
  }),
);
bottomArea.add(helpRow);

root.add(bottomArea);

renderer.root.add(root);
transcript.scrollTo(0);
composer.focus();
renderer.requestRender();
