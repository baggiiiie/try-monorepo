import * as readline from "readline";
import { handleTurn, Message } from "./agent";
import { log } from "./log";

async function main() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const messages: Message[] = [
        {
            role: "system",
            content:
                "You are a helpful coding assistant. You have access to a few tools.",
        },
    ];

    console.log("Agent ready. Type your message (Ctrl+C to quit).\n");

    const prompt = (query: string): Promise<string> =>
        new Promise((resolve) => rl.question(query, resolve));

    while (true) {
        const userInput = await prompt("You> ");
        if (!userInput.trim()) continue;

        messages.push({ role: "user", content: userInput });
        await handleTurn(messages);
    }
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
