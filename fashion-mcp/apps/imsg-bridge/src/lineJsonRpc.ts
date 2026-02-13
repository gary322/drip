import { createInterface } from "node:readline";

export type JsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string;
  result?: unknown;
  error?: unknown;
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  timeout: NodeJS.Timeout | null;
};

export class LineJsonRpcClient {
  private readonly pending = new Map<string, Pending>();
  private nextId = 1;
  private onNotificationHandler: ((note: JsonRpcNotification) => void) | null = null;

  constructor(
    private readonly input: NodeJS.ReadableStream,
    private readonly output: NodeJS.WritableStream
  ) {
    const rl = createInterface({ input: this.input });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let parsed: any;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        return;
      }

      if (parsed && typeof parsed === "object" && typeof parsed.id === "string") {
        const pending = this.pending.get(parsed.id);
        if (!pending) return;
        this.pending.delete(parsed.id);
        if (pending.timeout) clearTimeout(pending.timeout);
        if (Object.prototype.hasOwnProperty.call(parsed, "error") && parsed.error != null) {
          pending.reject(parsed.error);
        } else {
          pending.resolve((parsed as JsonRpcResponse).result);
        }
        return;
      }

      if (parsed && typeof parsed === "object" && typeof parsed.method === "string") {
        this.onNotificationHandler?.(parsed as JsonRpcNotification);
      }
    });
  }

  onNotification(handler: (note: JsonRpcNotification) => void): void {
    this.onNotificationHandler = handler;
  }

  call(method: string, params: unknown, timeoutMs = 30_000): Promise<unknown> {
    const id = String(this.nextId++);
    const payload = { jsonrpc: "2.0", id, method, params };
    const line = JSON.stringify(payload);

    return new Promise((resolve, reject) => {
      const timeout =
        timeoutMs > 0
          ? setTimeout(() => {
              this.pending.delete(id);
              reject(new Error(`rpc_timeout:${method}:${timeoutMs}ms`));
            }, timeoutMs)
          : null;

      this.pending.set(id, { resolve, reject, timeout });
      this.output.write(`${line}\n`);
    });
  }

  notify(method: string, params: unknown): void {
    const payload = { jsonrpc: "2.0", method, params };
    this.output.write(`${JSON.stringify(payload)}\n`);
  }
}

