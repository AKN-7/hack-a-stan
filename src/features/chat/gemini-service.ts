import { GoogleGenerativeAI } from "@google/generative-ai";

interface GenerateImageParams {
  prompt: string;
  style?: string;
  aspectRatio?: "9:16" | "16:9" | "1:1";
}

interface GenerateImageResult {
  success: boolean;
  imageData?: string; // Base64 encoded image
  mimeType?: string;
  error?: string;
}

// Initialize Gemini client
const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY environment variable is not set");
  }
  return new GoogleGenerativeAI(apiKey);
};

/**
 * Generate an image using Gemini's image generation capabilities
 */
export async function generateImage(params: GenerateImageParams): Promise<GenerateImageResult> {
  const { prompt, style = "photorealistic", aspectRatio = "9:16" } = params;

  try {
    const genAI = getGeminiClient();

    // Use Gemini 2.0 Flash for image generation
    // Note: As of early 2025, Gemini 2.0 Flash supports native image generation
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash-exp",
    });

    // Build enhanced prompt for better results
    const enhancedPrompt = buildImagePrompt(prompt, style, aspectRatio);

    // Generate content with image output
    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: enhancedPrompt,
            },
          ],
        },
      ],
      generationConfig: {
        // Request image output
        responseModalities: ["image", "text"],
      } as any, // Type assertion needed for newer API features
    });

    const response = result.response;

    // Extract image from response
    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if ("inlineData" in part && part.inlineData) {
        return {
          success: true,
          imageData: part.inlineData.data,
          mimeType: part.inlineData.mimeType,
        };
      }
    }

    // If no image was generated, return the text response as error context
    const textResponse = response.text();
    return {
      success: false,
      error: `No image generated. Model response: ${textResponse}`,
    };
  } catch (error) {
    console.error("Gemini image generation error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error during image generation",
    };
  }
}

/**
 * Generate a text description or suggestion using Gemini
 */
export async function generateText(prompt: string): Promise<string> {
  try {
    const genAI = getGeminiClient();
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (error) {
    console.error("Gemini text generation error:", error);
    throw error;
  }
}

/**
 * Analyze video content and suggest B-roll opportunities
 */
export async function suggestBrollOpportunities(transcript: string): Promise<string[]> {
  try {
    const genAI = getGeminiClient();
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

    const prompt = `You are a video editor assistant. Analyze this transcript and suggest 3-5 specific B-roll opportunities that would enhance the video. For each suggestion, provide a brief, specific image prompt that could be used to generate the B-roll.

Transcript:
${transcript}

Return your suggestions as a JSON array of objects with "timestamp_context" (the phrase where B-roll would fit), "prompt" (specific image generation prompt), and "reason" (why this B-roll would help).`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    // Parse the response
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const suggestions = JSON.parse(jsonMatch[0]);
        return suggestions.map((s: { prompt: string }) => s.prompt);
      }
    } catch {
      // If parsing fails, extract prompts manually
      const prompts = text.match(/["']prompt["']:\s*["']([^"']+)["']/g);
      if (prompts) {
        return prompts.map((p) => p.replace(/["']prompt["']:\s*["']/, "").replace(/["']$/, ""));
      }
    }

    return [];
  } catch (error) {
    console.error("B-roll suggestion error:", error);
    return [];
  }
}

/**
 * Build an enhanced prompt for image generation
 */
function buildImagePrompt(
  basePrompt: string,
  style: string,
  aspectRatio: string
): string {
  const styleDescriptions: Record<string, string> = {
    photorealistic: "photorealistic, high-quality photography, natural lighting, sharp focus",
    illustration: "digital illustration, clean lines, vibrant colors, modern art style",
    cinematic: "cinematic, movie still, dramatic lighting, film grain, anamorphic",
    minimalist: "minimalist, clean, simple, lots of negative space, modern design",
    abstract: "abstract, artistic, creative interpretation, bold colors and shapes",
  };

  const aspectDescriptions: Record<string, string> = {
    "9:16": "vertical format, portrait orientation, suitable for mobile/TikTok/Reels",
    "16:9": "horizontal format, landscape orientation, widescreen",
    "1:1": "square format, balanced composition",
  };

  return `Generate an image: ${basePrompt}

Style: ${styleDescriptions[style] || styleDescriptions.photorealistic}
Format: ${aspectDescriptions[aspectRatio] || aspectDescriptions["9:16"]}

Requirements:
- High quality, professional look
- Suitable for use as video B-roll
- No text or watermarks
- Engaging visual composition`;
}
