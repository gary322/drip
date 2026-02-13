import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { createFashionMcpServer } from '../apps/mcp-server/dist/mcp/server.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

const server = createFashionMcpServer();
const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
await server.connect(transport);

const srv = http.createServer(async (req, res) => {
  if (req.url !== '/mcp') {
    res.writeHead(404);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end();
    return;
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    res.writeHead(400);
    res.end('bad json');
    return;
  }

  await transport.handleRequest(req, res, body);
});

await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
const addr = srv.address();
const port = typeof addr === 'object' && addr ? addr.port : 0;

const init = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-11-05',
    capabilities: {},
    clientInfo: { name: 'mini-test', version: '1.0.0' },
  },
};

const r = await fetch(`http://127.0.0.1:${port}/mcp`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    origin: 'http://localhost:8787',
  },
  body: JSON.stringify(init),
});

console.log('status', r.status);
console.log('content-type', r.headers.get('content-type'));
console.log('mcp-session-id', r.headers.get('mcp-session-id'));
const text = await r.text();
console.log('body', text.slice(0, 300));

srv.close();
