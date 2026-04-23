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

// Connect via stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("MCP server running on stdio");
