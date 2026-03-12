import Groq from "groq-sdk";
import OpenAI from "openai";
import { tools, executeTool } from "./tools";
import { log } from "./log";

type Provider = "groq" | "ollama";

const PROVIDER: Provider = (process.env.PROVIDER as Provider) || "groq";

function createClient(): { client: any; model: string } {
    if (PROVIDER === "ollama") {
        return {
            client: new OpenAI({
                baseURL: "http://localhost:11434/v1",
                apiKey: "ollama",
            }),
            model: process.env.OLLAMA_MODEL || "gpt-oss:20b",
        };
    }
    return {
        client: new Groq(),
        model: "openai/gpt-oss-20b",
    };
}

const { client, model } = createClient();

export type Message = Groq.Chat.Completions.ChatCompletionMessageParam;

export async function handleTurn(messages: Message[]) {
    const MAX_ITERATIONS = 20;
    let iterations = 0;

    while (iterations++ < MAX_ITERATIONS) {
        const response = await client.chat.completions.create({
            model,
            messages,
            tools,
            tool_choice: "auto",
            temperature: 0.6,
            max_completion_tokens: 4096,
        });

        const choice = response.choices[0];
        const assistantMessage = choice.message;

        if ((assistantMessage as any).reasoning) {
            log("REASONING", (assistantMessage as any).reasoning);
        }

        if (assistantMessage.content) {
            log("ASSISTANT", assistantMessage.content);
        }

        messages.push(assistantMessage as Message);

        if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
            break;
        }

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
}
