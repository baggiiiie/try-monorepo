import Groq from "groq-sdk";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

export const tools: Groq.Chat.Completions.ChatCompletionTool[] = [
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
    {
        type: "function",
        function: {
            name: "edit_file",
            description:
                "Edit a file by replacing an exact string match with new content. The old_str must appear exactly once in the file.",
            parameters: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "Absolute or relative file path to edit",
                    },
                    old_str: {
                        type: "string",
                        description: "The exact string in the file to replace (must match exactly once)",
                    },
                    new_str: {
                        type: "string",
                        description: "The new string to replace old_str with",
                    },
                },
                required: ["path", "old_str", "new_str"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "bash",
            description:
                "Run a shell command using bash and return stdout and stderr. Use for running programs, installing packages, searching files, etc.",
            parameters: {
                type: "object",
                properties: {
                    command: {
                        type: "string",
                        description: "The shell command to execute",
                    },
                    timeout: {
                        type: "number",
                        description: "Timeout in milliseconds (default: 30000)",
                    },
                },
                required: ["command"],
            },
        },
    },
];

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

function editFile(filePath: string, oldStr: string, newStr: string): string {
    try {
        const resolved = path.resolve(filePath);
        const content = fs.readFileSync(resolved, "utf-8");
        const occurrences = content.split(oldStr).length - 1;
        if (occurrences === 0) {
            return `Error: old_str not found in ${resolved}`;
        }
        if (occurrences > 1) {
            return `Error: old_str appears ${occurrences} times in ${resolved}. It must appear exactly once.`;
        }
        const newContent = content.replace(oldStr, newStr);
        fs.writeFileSync(resolved, newContent, "utf-8");
        return `Successfully edited ${resolved}`;
    } catch (e: any) {
        return `Error editing file: ${e.message}`;
    }
}

function bash(command: string, timeout: number = 30000): string {
    try {
        const output = execSync(command, {
            encoding: "utf-8",
            timeout,
            shell: "/bin/bash",
            maxBuffer: 1024 * 1024,
        });
        return output || "(no output)";
    } catch (e: any) {
        if (e.stdout || e.stderr) {
            return [e.stdout, e.stderr].filter(Boolean).join("\n");
        }
        return `Error: ${e.message}`;
    }
}

export function executeTool(name: string, args: Record<string, string>): string {
    switch (name) {
        case "read_file":
            return readFile(args.path);
        case "write_file":
            return writeFile(args.path, args.content);
        case "edit_file":
            return editFile(args.path, args.old_str, args.new_str);
        case "bash":
            return bash(args.command, Number(args.timeout) || 30000);
        default:
            return `Unknown tool: ${name}`;
    }
}
