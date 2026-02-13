import type { ChannelType } from "./types.js";
import {
  claimNextOutboundChannelMessage,
  markChannelMessageFailed,
  markChannelMessageSent,
  type ChannelMessageRow,
} from "../db/repos/channelRepo.js";

export type ChannelSendResult = {
  providerMessageId?: string;
  responseCode?: number;
  responseBody?: string;
};

export type ChannelSenderAdapter = {
  send: (message: ChannelMessageRow) => Promise<ChannelSendResult>;
};

type SenderWorkerDeps = {
  claimNextOutboundChannelMessage: typeof claimNextOutboundChannelMessage;
  markChannelMessageSent: typeof markChannelMessageSent;
  markChannelMessageFailed: typeof markChannelMessageFailed;
};

export type ProcessBatchInput = {
  channel: ChannelType;
  sender: ChannelSenderAdapter;
  maxBatchSize?: number;
  maxAttempts?: number;
};

const defaultDeps: SenderWorkerDeps = {
  claimNextOutboundChannelMessage,
  markChannelMessageSent,
  markChannelMessageFailed,
};

export async function processChannelSenderBatch(
  input: ProcessBatchInput,
  deps: SenderWorkerDeps = defaultDeps
): Promise<{ processed: number; sent: number; failed: number; deadLettered: number }> {
  const maxBatchSize = Math.max(1, input.maxBatchSize ?? 10);
  const maxAttempts = Math.max(1, input.maxAttempts ?? 8);

  let processed = 0;
  let sent = 0;
  let failed = 0;
  let deadLettered = 0;

  for (let i = 0; i < maxBatchSize; i += 1) {
    const message = await deps.claimNextOutboundChannelMessage({ channel: input.channel });
    if (!message) break;
    processed += 1;

    try {
      const response = await input.sender.send(message);
      await deps.markChannelMessageSent({
        channelMessageId: message.id,
        providerMessageId: response.providerMessageId,
        responseCode: response.responseCode,
        responseBody: response.responseBody,
      });
      sent += 1;
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      const failResult = await deps.markChannelMessageFailed({
        channelMessageId: message.id,
        error: messageText,
        maxAttempts,
      });
      failed += 1;
      if (failResult.deadLettered) deadLettered += 1;
    }
  }

  return { processed, sent, failed, deadLettered };
}

export async function startChannelSenderWorker(input: {
  channel: ChannelType;
  sender: ChannelSenderAdapter;
  pollIntervalMs?: number;
  maxBatchSize?: number;
  maxAttempts?: number;
}): Promise<{ stop: () => void }> {
  const pollIntervalMs = Math.max(250, input.pollIntervalMs ?? 1_000);
  let stopped = false;
  let running = false;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await processChannelSenderBatch({
        channel: input.channel,
        sender: input.sender,
        maxBatchSize: input.maxBatchSize,
        maxAttempts: input.maxAttempts,
      });
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, pollIntervalMs);
  void tick();

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
