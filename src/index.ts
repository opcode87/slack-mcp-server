import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { WebClient } from '@slack/web-api';
import dotenv from 'dotenv';

dotenv.config();

const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

function createServer() {
  const server = new Server(
    {
      name: 'slack-mcp-server',
      version: '1.0.0',
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
          name: 'post_message',
          description: 'Post a message to a Slack channel',
          inputSchema: {
            type: 'object',
            properties: {
              channel: { type: 'string', description: 'Channel ID or name' },
              text: { type: 'string', description: 'Message text' },
            },
            required: ['channel', 'text'],
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === 'post_message') {
      const { channel, text } = request.params.arguments as { channel: string; text: string };
      try {
        await slackClient.chat.postMessage({ channel, text });
        return { content: [{ type: 'text', text: `Message sent to ${channel}` }] };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: String(error) }] };
      }
    }
    throw new Error('Tool not found');
  });

  return server;
}

const app = express();
let sseTransport: SSEServerTransport | null = null;

app.get('/sse', async (req, res) => {
  console.log('New SSE connection requested');
  try {
    const server = createServer();
    sseTransport = new SSEServerTransport('/messages', res as any);
    await server.connect(sseTransport);
    
    req.on('close', () => {
      console.log('SSE connection closed');
    });
  } catch (error) {
    console.error('Error in /sse handler:', error);
    if (!res.headersSent) {
      res.status(500).send('Internal Server Error');
    }
  }
});

app.post('/messages', express.json(), async (req, res) => {
  if (!sseTransport) {
    res.status(400).send('No active SSE connection');
    return;
  }
  try {
    await sseTransport.handleMessage(req as any, res as any);
  } catch (error) {
    console.error('Error handling message:', error);
    if (!res.headersSent) {
      res.status(500).send('Error handling message');
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
