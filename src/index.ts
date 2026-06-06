import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { WebClient } from '@slack/web-api';
import dotenv from 'dotenv';
import sqlite3 from 'sqlite3';
import { promisify } from 'util';

dotenv.config();

// Database setup
const db = new sqlite3.Database('tokens.db');
const dbRun = promisify(db.run.bind(db)) as (sql: string, ...params: any[]) => Promise<void>;
const dbGet = promisify(db.get.bind(db)) as (sql: string, ...params: any[]) => Promise<any>;

// Initialize database
dbRun('CREATE TABLE IF NOT EXISTS user_tokens (user_id TEXT PRIMARY KEY, slack_token TEXT)')
  .then(() => console.log('Database initialized'))
  .catch((err) => console.error('Database initialization error:', err));

async function getSlackToken(userId: string): Promise<string | undefined> {
  const row = await dbGet('SELECT slack_token FROM user_tokens WHERE user_id = ?', [userId]) as { slack_token: string } | undefined;
  return row?.slack_token;
}

async function setSlackToken(userId: string, token: string): Promise<void> {
  await dbRun('INSERT OR REPLACE INTO user_tokens (user_id, slack_token) VALUES (?, ?)', [userId, token]);
}

function createServer(slackToken?: string) {
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
    if (!slackToken) {
      return {
        tools: [
          {
            name: 'authorization_required',
            description: 'This server requires authorization. Please visit the /auth/slack endpoint.',
            inputSchema: { type: 'object', properties: {} }
          }
        ],
      };
    }

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
    if (!slackToken) {
      return {
        isError: true,
        content: [{ type: 'text', text: 'Error: Slack authorization is required. Please visit /auth/slack to authorize.' }]
      };
    }

    const slackClient = new WebClient(slackToken);

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
const activeTransports = new Map<string, SSEServerTransport>();

// Root route for health check
app.get('/', (req, res) => {
  res.send('Multi-tenant Slack MCP Server is running.');
});

// Slack OAuth Endpoints
app.get('/auth/slack', (req, res) => {
  const userId = req.query.userId as string;
  if (!userId) {
    res.status(400).send('userId query parameter is required');
    return;
  }

  const clientId = process.env.SLACK_CLIENT_ID;
  const redirectUri = process.env.SLACK_REDIRECT_URI;
  const scopes = 'chat:write,channels:read,groups:read';
  
  if (!clientId || !redirectUri) {
    console.error('Missing SLACK_CLIENT_ID or SLACK_REDIRECT_URI');
    res.status(500).send('Server configuration error: Missing Client ID or Redirect URI');
    return;
  }

  const slackAuthUrl = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${userId}`;
  res.redirect(slackAuthUrl);
});

app.get('/auth/slack/callback', async (req, res) => {
  const { code, state: userId } = req.query;
  
  if (!code || !userId) {
    res.status(400).send('Missing code or state');
    return;
  }

  try {
    const client = new WebClient();
    const result = await client.oauth.v2.access({
      client_id: process.env.SLACK_CLIENT_ID!,
      client_secret: process.env.SLACK_CLIENT_SECRET!,
      code: code as string,
      redirect_uri: process.env.SLACK_REDIRECT_URI!,
    });

    if (result.ok && result.access_token) {
      await setSlackToken(userId as string, result.access_token);
      res.redirect('https://poke.com');
    } else {
      res.status(500).send(`Slack OAuth error: ${result.error}`);
    }
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/sse', async (req, res) => {
  const userId = req.query.userId as string;
  console.log(`New SSE connection requested. UserID: ${userId || 'none'}`);
  
  try {
    let slackToken: string | undefined;
    if (userId) {
      slackToken = await getSlackToken(userId);
    }

    // Always allow the handshake to succeed with HTTP 200
    const server = createServer(slackToken);
    
    // Construct the absolute URL for the messages endpoint
    const host = req.get('host');
    const protocol = req.protocol;
    const messagesUrl = `${protocol}://${host}/messages`;
    
    const transport = new SSEServerTransport(messagesUrl, res as any);
    await server.connect(transport);
    
    const sessionId = transport.sessionId;
    activeTransports.set(sessionId, transport);
    console.log(`Session ${sessionId} started for user ${userId || 'anonymous'}. Messages URL: ${messagesUrl}`);
    
    req.on('close', () => {
      activeTransports.delete(sessionId);
      console.log(`Session ${sessionId} closed for user ${userId || 'anonymous'}`);
    });
  } catch (error) {
    console.error('Error in /sse handler:', error);
    if (!res.headersSent) {
      res.status(500).send('Internal Server Error');
    }
  }
});

app.post('/messages', express.json(), async (req, res) => {
  const sessionId = req.query.sessionId as string;
  if (!sessionId) {
    res.status(400).send('sessionId query parameter is required');
    return;
  }

  const transport = activeTransports.get(sessionId);
  if (!transport) {
    res.status(404).send(`No active session found for ID: ${sessionId}`);
    return;
  }

  try {
    await transport.handleMessage(req as any, res as any);
  } catch (error) {
    console.error(`Error handling message for session ${sessionId}:`, error);
    if (!res.headersSent) {
      res.status(500).send('Error handling message');
    }
  }
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Multi-tenant Slack MCP Server listening on 0.0.0.0:${PORT}`);
});
