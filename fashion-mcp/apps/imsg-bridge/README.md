# imsg-bridge

Bridges macOS Messages.app (iMessage/SMS) to the `@fashion/mcp-server` omnichannel inbox/outbox.

This component runs on **macOS** (a Mac mini / MacStadium host, etc.) because iMessage is not available on AWS.
Your backend stays on AWS; this bridge connects to it over HTTPS.

## Prereqs

1. Build/install `imsg` (https://github.com/steipete/imsg) on the Mac running this bridge.
2. Grant permissions:
   - Full Disk Access for your terminal (to read `~/Library/Messages/chat.db`)
   - Automation permission to control Messages.app (for sending)

## Run (local dev)

In one terminal:

```bash
cd apps/mcp-server
docker compose up -d
npm run db:migrate
npm run db:seed
npm run dev
```

In another terminal:

```bash
cd apps/imsg-bridge
cp .env.example .env
# set BRIDGE_SHARED_SECRET to match apps/mcp-server IMESSAGE_BRIDGE_SHARED_SECRET
npm run dev
```

## Notes

- Inbound attachments are uploaded to the backend via `POST /channels/imessage/upload`.
- Outbound image parts are downloaded from `imageUrl` and sent as attachments.

