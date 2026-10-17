import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './mcp.js';
import { createDriverProvider } from './driver/provider.js';

const server = new McpServer({ name: 'tradingview-bridge', version: '0.1.0' });
registerTools(server, createDriverProvider());
await server.connect(new StdioServerTransport());
// stdout carries MCP JSON-RPC; log to stderr only.
console.error('tradingview-bridge MCP server ready (stdio)');
