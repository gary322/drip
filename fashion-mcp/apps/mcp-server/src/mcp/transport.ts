import express, { Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getRequestListener } from "@hono/node-server";
import { verifyAccessToken } from "../auth/verifyAccessToken.js";
import { sendAuthChallenge } from "../auth/challenge.js";
import { runWithAuth } from "../auth/requestContext.js";
import { AuthzError } from "../auth/authz.js";
import { isAllowedOrigin } from "../middleware/originGuard.js";
import { IdempotencyConflictError } from "../db/repos/idempotencyRepo.js";

/**
 * Creates an express Router mounted at /mcp that hands requests to the MCP transport.
 *
 * IMPORTANT: In stateless mode (`sessionIdGenerator: undefined`), the MCP SDK requires you to create
 * a fresh transport per HTTP request. A single transport instance cannot be reused.
 *
 * This implementation is stateless-per-request, which is friendly to horizontal scaling.
 */
export function createTransportAndBind(createServer: () => McpServer) {
  const router = express.Router();

  const setup = async () => {
    // No-op: we create/connect a fresh server+transport per request.
  };

  // Optional: handle OPTIONS for preflight (some hosts/tools may do this)
  router.options("/", (req, res) => {
    const origin = req.headers.origin;
    if (origin && !isAllowedOrigin(origin)) {
      return res.status(403).json({ error: "forbidden_origin" });
    }
    const allowOrigin = origin ?? "https://chatgpt.com";
    res.writeHead(204, {
      "Access-Control-Allow-Origin": allowOrigin,
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, authorization, mcp-session-id",
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
      Vary: "Origin",
    });
    res.end();
  });

  router.post("/", async (req: Request, res: Response) => {
    try {
      // In production: you can allow some calls unauthenticated (e.g., public tools),
      // but for this product we require auth for all MCP traffic.
      const auth = await verifyAccessToken(req);
      if (!auth) {
        return sendAuthChallenge(res, ["profile:read"]);
      }

      // Make auth available to tool handlers via AsyncLocalStorage.
      await runWithAuth(auth, async () => {
        const server = createServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          // JSON responses are simplest for infra and for debugging.
          // Clients still send `Accept: application/json, text/event-stream` and can handle either.
          enableJsonResponse: true,
        });
        await server.connect(transport);

        // StreamableHTTPServerTransport internally uses @hono/node-server.
        // Unfortunately, @hono/node-server swallows rejected fetchCallback promises unless an errorHandler is provided.
        // We bind our own request listener so transport errors are logged and surfaced as JSON-RPC errors.
        const handler = getRequestListener(
          async (webRequest) => {
            return (transport as any)._webStandardTransport.handleRequest(webRequest, {
              authInfo: (req as any).auth,
              parsedBody: req.body,
            });
          },
          {
            overrideGlobalObjects: false,
            errorHandler: async (err) => {
              console.error("MCP request handler threw:", err);
              return new Response(
                JSON.stringify({
                  jsonrpc: "2.0",
                  error: { code: -32603, message: "Internal server error" },
                  id: null,
                }),
                { status: 500, headers: { "Content-Type": "application/json" } }
              );
            },
          }
        );

        await handler(req, res);
        await transport.close();
        await server.close();
      });
    } catch (error) {
      if (error instanceof AuthzError) {
        if (!res.headersSent) {
          res.status(error.statusCode).json({
            jsonrpc: "2.0",
            error: {
              code: error.statusCode === 401 ? -32001 : -32003,
              message: error.message,
              data: {
                requiredScopes: error.requiredScopes,
              },
            },
            id: null,
          });
        }
        return;
      }
      if (error instanceof IdempotencyConflictError) {
        if (!res.headersSent) {
          res.status(409).json({
            jsonrpc: "2.0",
            error: {
              code: -32009,
              message: "idempotency_key_conflict",
            },
            id: null,
          });
        }
        return;
      }
      console.error("Unhandled MCP transport error", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  // Streamable HTTP uses GET for some flows; we return 405 here like many examples.
  router.get("/", (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
  });

  return { mcpRouter: router, setup };
}
