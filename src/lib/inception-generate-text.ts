import { generateText } from "ai";
import { assertInceptionApiKey, mercuryChatModel } from "./inception-mercury";

export async function generateMercuryText(options: {
  system: string;
  user: string;
  maxOutputTokens?: number;
  temperature?: number;
}): Promise<string> {
  assertInceptionApiKey();
  const { text } = await generateText({
    model: mercuryChatModel,
    system: options.system,
    messages: [{ role: "user", content: options.user }],
    maxOutputTokens: options.maxOutputTokens ?? 4096,
    temperature: options.temperature ?? 0,
  });
  return text;
}
