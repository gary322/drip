import type { ChannelOutboundMessage } from "@fashion/shared";

export function buildTextFromParts(parts: ChannelOutboundMessage["parts"]): string {
  const lines: string[] = [];
  for (const part of parts) {
    if (part.type === "text" && typeof part.text === "string") {
      lines.push(part.text.trim());
    }
    if (part.type === "link" && typeof part.url === "string") {
      lines.push(part.url);
    }
  }
  return lines.filter(Boolean).join("\n").trim();
}

export function pickFirstImage(parts: ChannelOutboundMessage["parts"]): { imageUrl: string; caption?: string } | null {
  for (const part of parts) {
    if (part.type === "image" && typeof part.imageUrl === "string") {
      return { imageUrl: part.imageUrl, caption: part.caption };
    }
  }
  return null;
}

