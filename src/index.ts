import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { WebClient } from "@slack/web-api";

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

if (!SLACK_BOT_TOKEN) {
  console.error("SLACK_BOT_TOKEN environment variable is required");
  process.exit(1);
}

const slack = new WebClient(SLACK_BOT_TOKEN);

const server = new Server(
  {
    name: "slack-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "post_message",
        description: "Post a message to a Slack channel",
        inputSchema: {
          type: "object",
          properties: {
            channel: {
              type: "string",
              description: "The ID or name of the channel to post to",
            },
            text: {
              type: "string",
              description: "The message text to post",
            },
          },
          required: ["channel", "text"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "post_message") {
    const { channel, text } = request.params.arguments as {
      channel: string;
      text: string;
    };

    try {
      const result = await slack.chat.postMessage({
        channel,
        text,
      });

      return {
        content: [
          {
            type: "text",
            text: `Message posted successfully to ${channel}. TS: ${result.ts}`,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error posting message: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  throw new Error(`Tool not found: ${request.params.name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Slack MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
