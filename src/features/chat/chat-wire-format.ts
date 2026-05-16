import type { ModelMessage, TextPart, ToolCallPart } from "ai";

/**
 * Wire format expected by the editor chat client (matches the former Anthropic Messages API shape).
 */
export type WireTextBlock = { type: "text"; text: string };

export type WireToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type WireContentBlock = WireTextBlock | WireToolUseBlock;

export type WireToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};

/** Messages the client sends on POST / PUT */
export type WireChatMessage = {
  role: "user" | "assistant";
  content: string | WireContentBlock[] | WireToolResultBlock[];
};

export type WireAssistantResponse = {
  id: string;
  content: WireContentBlock[];
  stop_reason: "end_turn" | "tool_use" | "max_tokens";
};

function isToolResultArray(
  content: WireChatMessage["content"],
): content is WireToolResultBlock[] {
  return (
    Array.isArray(content) &&
    content.length > 0 &&
    content[0]?.type === "tool_result"
  );
}

/**
 * Convert client wire messages to AI SDK {@link ModelMessage} list.
 * Tracks `tool_use_id → toolName` from assistant tool_use blocks for tool results.
 */
export function wireMessagesToModelMessages(
  messages: WireChatMessage[],
): ModelMessage[] {
  const toolIdToName = new Map<string, string>();
  const out: ModelMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        out.push({ role: "user", content: msg.content });
        continue;
      }
      if (isToolResultArray(msg.content)) {
        out.push({
          role: "tool",
          content: msg.content.map((tr) => {
            const toolName =
              toolIdToName.get(tr.tool_use_id) ?? "unknown_tool";
            let parsed: unknown = tr.content;
            try {
              parsed = JSON.parse(tr.content);
            } catch {
              /* keep string */
            }
            return {
              type: "tool-result" as const,
              toolCallId: tr.tool_use_id,
              toolName,
              output: tr.is_error
                ? {
                    type: "error-text" as const,
                    value:
                      typeof parsed === "string"
                        ? parsed
                        : JSON.stringify(parsed),
                  }
                : typeof parsed === "string"
                  ? { type: "text" as const, value: parsed }
                  : { type: "json" as const, value: parsed },
            };
          }),
        } as ModelMessage);
        continue;
      }
      continue;
    }

    // assistant
    if (typeof msg.content === "string") {
      out.push({ role: "assistant", content: msg.content });
      continue;
    }

    const assistantParts: Array<TextPart | ToolCallPart> = [];

    for (const block of msg.content) {
      if (block.type === "text") {
        assistantParts.push({ type: "text", text: block.text });
      } else if (block.type === "tool_use") {
        toolIdToName.set(block.id, block.name);
        assistantParts.push({
          type: "tool-call",
          toolCallId: block.id,
          toolName: block.name,
          input: block.input,
        });
      }
    }
    out.push({ role: "assistant", content: assistantParts });
  }

  return out;
}

/** Narrow shape of `generateText` result used for the wire response. */
type GenerateTextResultShape = {
  text: string;
  toolCalls: Array<{
    toolCallId: string;
    toolName: string;
    input?: unknown;
  }>;
  finishReason: string;
  response?: { id?: string };
};

export function generateTextResultToWireResponse(
  result: GenerateTextResultShape,
): WireAssistantResponse {
  const content: WireContentBlock[] = [];
  if (result.text?.trim()) {
    content.push({ type: "text", text: result.text });
  }
  for (const tc of result.toolCalls) {
    content.push({
      type: "tool_use",
      id: tc.toolCallId,
      name: tc.toolName,
      input: (tc.input ?? {}) as Record<string, unknown>,
    });
  }

  const stop_reason: WireAssistantResponse["stop_reason"] =
    result.toolCalls.length > 0
      ? "tool_use"
      : result.finishReason === "length"
        ? "max_tokens"
        : "end_turn";

  const meta = result.response as { id?: string } | undefined;
  const id =
    (meta && typeof meta.id === "string" && meta.id) || `mercury-${Date.now()}`;

  return { id, content, stop_reason };
}
