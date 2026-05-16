import { createOpenAI } from "@ai-sdk/openai";

/**
 * Inception Mercury — OpenAI-compatible Chat Completions API.
 * @see https://api.inceptionlabs.ai/v1/chat/completions
 */
export const inceptionMercuryProvider = createOpenAI({
  baseURL: "https://api.inceptionlabs.ai/v1",
  apiKey: process.env.INCEPTION_API_KEY,
  name: "inception",
});

/** Use `.chat()` so requests hit /v1/chat/completions (not OpenAI Responses API). */
export const mercuryChatModel = inceptionMercuryProvider.chat("mercury-2");

export function assertInceptionApiKey(): void {
  if (!process.env.INCEPTION_API_KEY) {
    throw new Error("INCEPTION_API_KEY is not set");
  }
}
