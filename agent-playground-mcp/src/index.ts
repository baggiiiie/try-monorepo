import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
    name: "example-server",
    version: "0.0.1",
});

// Tool: greet a user
server.registerTool("greet",
    {
        description: "Greet a user by name",
        inputSchema: { name: z.string() }
    }, async ({ name }) => ({
        content: [{ type: "text", text: `Hello, ${name}! Welcome to the MCP server.` }],
    }));

// Tool: add two numbers
server.registerTool(
    "add",
    {
        description: "Add two numbers together",
        inputSchema: { a: z.number(), b: z.number() },
    },
    async ({ a, b }) => ({
        content: [{ type: "text", text: `${a} + ${b} = ${a + b}` }],
    })
);

// Tool: get current time
server.registerTool(
    "current_time",
    {
        description: "Get the current date and time"
    },
    async () => ({
        content: [{ type: "text", text: new Date().toISOString() }],
    }));

// --- Compose-friendly demo tools (good for showing off code-mode) ---

const USERS: Record<number, { id: number; name: string; email: string; role: "admin" | "member" }> = {
    1: { id: 1, name: "Alice",   email: "alice@example.io",   role: "admin" },
    2: { id: 2, name: "Bob",     email: "bob@example.io",     role: "member" },
    3: { id: 3, name: "Carol",   email: "carol@example.io",   role: "member" },
    4: { id: 4, name: "Dave",    email: "dave@example.io",    role: "admin" },
    5: { id: 5, name: "Eve",     email: "eve@example.io",     role: "member" },
};

// Tool: list_users — returns just id+name for every user
server.registerTool(
    "list_users",
    {
        description: "List all users (id and name only). Combine with get_user to fetch details.",
    },
    async () => ({
        content: [{
            type: "text",
            text: JSON.stringify(Object.values(USERS).map(u => ({ id: u.id, name: u.name }))),
        }],
    })
);

// Tool: get_user — full details for a single user id
server.registerTool(
    "get_user",
    {
        description: "Get full details (email, role) for a user by id",
        inputSchema: { id: z.number() },
    },
    async ({ id }) => {
        const u = USERS[id];
        if (!u) {
            return { content: [{ type: "text", text: `user ${id} not found` }], isError: true };
        }
        return { content: [{ type: "text", text: JSON.stringify(u) }] };
    }
);

// Connect via stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("MCP server running on stdio");
