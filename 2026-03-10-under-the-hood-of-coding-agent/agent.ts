import Groq from "groq-sdk";
import * as fs from "fs";
import * as path from "path";

const HTTP_LOG = path.resolve("http-requests.log");
fs.writeFileSync(HTTP_LOG, ""); // clear on each run

let requestCount = 0;

const groq = new Groq({
  fetch: async (url: RequestInfo, init?: RequestInit) => {
    requestCount++;
    const entry = [
      `\n${"=".repeat(80)}`,
      `REQUEST #${requestCount} — ${new Date().toISOString()}`,
      `URL: ${url}`,
      `Headers: ${JSON.stringify(Object.fromEntries(new Headers(init?.headers).entries()), null, 2)}`,
      `Body:\n${init?.body?.toString()}`,
      `${"=".repeat(80)}\n`,
    ].join("\n");
    fs.appendFileSync(HTTP_LOG, entry);
    const res = await fetch(url, init);
    const cloned = res.clone();
    const responseBody = await cloned.text();
    const resEntry = [
      `\n${"─".repeat(80)}`,
      `RESPONSE #${requestCount} — Status: ${res.status} ${res.statusText}`,
      `Body:\n${responseBody}`,
      `${"─".repeat(80)}\n`,
    ].join("\n");
    fs.appendFileSync(HTTP_LOG, resEntry);
    return res;
  },
}); // uses GROQ_API_KEY env var

const MODEL = "openai/gpt-oss-20b";

// ── Tool definitions ──────────────────────────────────────────────

const tools: Groq.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read the contents of a file at the given path. Returns the file contents as a string.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute or relative file path to read",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Write content to a file at the given path. Creates the file if it doesn't exist, overwrites if it does.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute or relative file path to write to",
          },
          content: {
            type: "string",
            description: "The content to write to the file",
          },
        },
        required: ["path", "content"],
      },
    },
  },
];

// ── Tool implementations ──────────────────────────────────────────

function readFile(filePath: string): string {
  try {
    const resolved = path.resolve(filePath);
    return fs.readFileSync(resolved, "utf-8");
  } catch (e: any) {
    return `Error reading file: ${e.message}`;
  }
}

function writeFile(filePath: string, content: string): string {
  try {
    const resolved = path.resolve(filePath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, content, "utf-8");
    return `Successfully wrote ${content.length} bytes to ${resolved}`;
  } catch (e: any) {
    return `Error writing file: ${e.message}`;
  }
}

function executeTool(name: string, args: Record<string, string>): string {
  switch (name) {
    case "read_file":
      return readFile(args.path);
    case "write_file":
      return writeFile(args.path, args.content);
    default:
      return `Unknown tool: ${name}`;
  }
}

// ── Pretty printing helpers ───────────────────────────────────────

function log(label: string, data: any) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`│ ${label}`);
  console.log(`${"─".repeat(60)}`);
  if (typeof data === "string") {
    console.log(data);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

// ── Agent loop ────────────────────────────────────────────────────

type Message = Groq.Chat.Completions.ChatCompletionMessageParam;

async function run(userPrompt: string) {
  const messages: Message[] = [
    {
      role: "system",
      content:
        "You are a helpful coding assistant. You have access to read_file and write_file tools to interact with the local filesystem. Use them when the user asks you to read, write, or modify files.",
    },
    { role: "user", content: userPrompt },
  ];

  log("USER", userPrompt);

  let iterations = 0;
  const MAX_ITERATIONS = 20;

  while (iterations++ < MAX_ITERATIONS) {
    const response = await groq.chat.completions.create({
      model: MODEL,
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0.6,
      max_completion_tokens: 4096,
    });

    const choice = response.choices[0];
    const assistantMessage = choice.message;

    // Show reasoning if present (some models include it)
    if ((assistantMessage as any).reasoning) {
      log("REASONING", (assistantMessage as any).reasoning);
    }

    // Show any text content
    if (assistantMessage.content) {
      log("ASSISTANT", assistantMessage.content);
    }

    // Append assistant message to conversation
    messages.push(assistantMessage as Message);

    // If no tool calls, we're done
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      log("FINISH REASON", choice.finish_reason);
      break;
    }

    // Process each tool call
    for (const toolCall of assistantMessage.tool_calls) {
      const fnName = toolCall.function.name;
      const fnArgs = JSON.parse(toolCall.function.arguments);

      log(`TOOL CALL: ${fnName}`, fnArgs);

      const result = executeTool(fnName, fnArgs);

      log(`TOOL RESULT: ${fnName}`, result);

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result,
      });
    }
  }

  if (iterations > MAX_ITERATIONS) {
    console.log("\n⚠️  Max iterations reached, stopping.");
  }

  // Write full conversation to file
  const logPath = path.resolve("conversation.log.json");
  fs.writeFileSync(logPath, JSON.stringify(messages, null, 2), "utf-8");
  log("SAVED", `Full conversation (${messages.length} messages) written to ${logPath}`);
}

// ── Main ──────────────────────────────────────────────────────────

const prompt = process.argv.slice(2).join(" ") || "What files are in the current directory? Read any interesting ones.";

run(prompt).catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
