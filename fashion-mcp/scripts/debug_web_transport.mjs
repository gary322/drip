import { randomUUID } from 'node:crypto';
import { createFashionMcpServer } from '../apps/mcp-server/dist/mcp/server.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

const server = createFashionMcpServer();

const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => randomUUID(),
});

await server.connect(transport);

const body = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-11-05',
    capabilities: {},
    clientInfo: { name: 'debug', version: '1.0.0' },
  },
};

const req = new Request('http://localhost:8787/mcp', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    origin: 'http://localhost:8787',
  },
  body: JSON.stringify(body),
});

try {
  // Call the underlying WebStandard transport directly to catch thrown errors.
  const web = transport._webStandardTransport;
  const res = await web.handleRequest(req, { parsedBody: body });
  console.log('status', res.status);
  console.log('headers', Object.fromEntries(res.headers.entries()));
  console.log('content-type', res.headers.get('content-type'));
  const text = await res.text();
  console.log('body', text.slice(0, 400));
} catch (e) {
  console.error('THREW', e);
}
