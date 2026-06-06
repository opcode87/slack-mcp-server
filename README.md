# Slack MCP Server

A Model Context Protocol (MCP) server for interacting with Slack.

## Features

- `post_message`: Post a message to a specific Slack channel.

## Deployment on Railway

1. **Fork or push this repository** to your GitHub account.
2. **Create a New Project** on Railway.
3. **Connect your GitHub repository**.
4. **Configure Environment Variables**:
   - Add `SLACK_BOT_TOKEN`: Your Slack Bot User OAuth Token (starts with `xoxb-`).
5. **Deploy**: Railway will automatically detect the Dockerfile and deploy the service.

## Usage with MCP Clients

Once deployed, you can connect to this server via its URL (if using a WebSocket/SSE transport) or run it locally using the built code. This specific setup is optimized for `stdio` transport, which is standard for local MCP tools. For remote deployment, you may need to wrap it in an SSE transport layer.
