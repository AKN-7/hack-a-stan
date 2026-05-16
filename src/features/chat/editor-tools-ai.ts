import { jsonSchema, tool } from "ai";
import { editorTools } from "./tools";

/**
 * AI SDK tool definitions (no server `execute` — the editor runs tools in the browser).
 */
export const editorAiTools = Object.fromEntries(
  editorTools.map((def) => [
    def.name,
    tool({
      description: def.description,
      inputSchema: jsonSchema(def.input_schema as never),
    }),
  ]),
);
