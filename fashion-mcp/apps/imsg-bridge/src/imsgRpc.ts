import { spawn, type ChildProcess } from "node:child_process";
import { LineJsonRpcClient, type JsonRpcNotification } from "./lineJsonRpc.js";

export type ImsgAttachment = {
  filename?: string | null;
  transfer_name?: string | null;
  uti?: string | null;
  mime_type?: string | null;
  total_bytes?: number | null;
  is_sticker?: boolean | null;
  original_path?: string | null;
  missing?: boolean | null;
};

export type ImsgMessage = {
  id: number;
  chat_id: number;
  guid?: string | null;
  sender?: string | null;
  is_from_me?: boolean | null;
  text?: string | null;
  created_at?: string | null;
  attachments?: ImsgAttachment[] | null;
  chat_identifier?: string | null;
  chat_guid?: string | null;
  chat_name?: string | null;
  participants?: string[] | null;
  is_group?: boolean | null;
};

export type WatchSubscribeParams = {
  chat_id?: number;
  since_rowid?: number;
  participants?: string[];
  attachments?: boolean;
};

export type ImsgSendParams =
  | {
      to: string;
      text?: string;
      file?: string;
      service?: "imessage" | "sms" | "auto";
      region?: string;
    }
  | {
      chat_id: number;
      text?: string;
      file?: string;
      service?: "imessage" | "sms" | "auto";
      region?: string;
    };

export class ImsgRpcClient {
  private readonly rpc: LineJsonRpcClient;

  constructor(private readonly child: ChildProcess) {
    if (!child.stdout || !child.stdin) {
      throw new Error("imsg_rpc_missing_stdio");
    }
    this.rpc = new LineJsonRpcClient(child.stdout, child.stdin);
  }

  onNotification(handler: (note: JsonRpcNotification) => void): void {
    this.rpc.onNotification(handler);
  }

  async subscribeWatch(params: WatchSubscribeParams): Promise<number> {
    const result = (await this.rpc.call("watch.subscribe", params, 30_000)) as any;
    const subscription = typeof result?.subscription === "number" ? result.subscription : null;
    if (!subscription) throw new Error("imsg_watch_subscribe_failed");
    return subscription;
  }

  async send(params: ImsgSendParams): Promise<void> {
    await this.rpc.call("send", params, 30_000);
  }

  close(): void {
    this.child.kill();
  }
}

export function spawnImsgRpc(input: { bin: string; args?: string[]; env?: NodeJS.ProcessEnv }): ImsgRpcClient {
  const child = spawn(input.bin, input.args ?? ["rpc"], {
    stdio: ["pipe", "pipe", "inherit"],
    env: input.env ?? process.env,
  });

  return new ImsgRpcClient(child);
}
