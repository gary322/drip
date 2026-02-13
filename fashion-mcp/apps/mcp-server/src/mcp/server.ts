import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { registerCatalogTools } from "./tools/catalog.js";
import { registerCheckoutTools } from "./tools/checkout.js";
import { registerFeedbackTools } from "./tools/feedback.js";
import { registerPlanningTools } from "./tools/planning.js";
import { registerProfileTools } from "./tools/profile.js";
import { registerStyleMapTools } from "./tools/styleMap.js";
import { registerTryonTools } from "./tools/tryon.js";
import { STYLE_MAP_RESOURCE_URI } from "./tools/shared.js";

const styleMapHtml = readFileSync(new URL("../../public/style-map.html", import.meta.url), "utf8");

export function createFashionMcpServer() {
  const server = new McpServer({ name: "fashion-stylist", version: "0.2.0" });

  registerAppResource(
    server,
    "style-map",
    STYLE_MAP_RESOURCE_URI,
    {},
    async () => ({
      contents: [
        {
          uri: STYLE_MAP_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: styleMapHtml,
        },
      ],
    })
  );

  registerProfileTools(server);
  registerCatalogTools(server);
  registerStyleMapTools(server);
  registerFeedbackTools(server);
  registerPlanningTools(server);
  registerTryonTools(server);
  registerCheckoutTools(server);

  return server;
}

