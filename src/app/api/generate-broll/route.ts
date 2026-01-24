import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { nanoid } from "nanoid";

// Initialize clients
const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY is required");
  }
  return new GoogleGenerativeAI(apiKey);
};

const getS3Client = () => {
  return new S3Client({
    region: process.env.REMOTION_AWS_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.REMOTION_AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.REMOTION_AWS_SECRET_ACCESS_KEY!,
    },
  });
};

interface GenerateBrollRequest {
  prompt: string;
  style?: string;
  aspectRatio?: "9:16" | "16:9" | "1:1";
}

function buildImagePrompt(
  basePrompt: string,
  style: string,
  aspectRatio: string
): string {
  const styleDescriptions: Record<string, string> = {
    photorealistic: "photorealistic, high-quality photography, natural lighting, sharp focus, professional",
    illustration: "digital illustration, clean vector style, vibrant colors, modern art",
    cinematic: "cinematic, movie still, dramatic lighting, film grain, anamorphic lens flare",
    minimalist: "minimalist, clean, simple composition, lots of negative space, modern design",
    abstract: "abstract art, creative interpretation, bold colors, geometric shapes, artistic",
  };

  const aspectDescriptions: Record<string, string> = {
    "9:16": "vertical portrait orientation (9:16 aspect ratio), optimized for mobile viewing",
    "16:9": "horizontal landscape orientation (16:9 aspect ratio), widescreen format",
    "1:1": "square format (1:1 aspect ratio), balanced composition",
  };

  return `Generate a high-quality image: ${basePrompt}

Visual Style: ${styleDescriptions[style] || styleDescriptions.photorealistic}
Aspect Ratio: ${aspectDescriptions[aspectRatio] || aspectDescriptions["9:16"]}

Requirements:
- Professional quality suitable for video B-roll
- No text, watermarks, or logos
- Engaging visual composition
- High resolution and sharp details`;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as GenerateBrollRequest;
    const { prompt, style = "photorealistic", aspectRatio = "9:16" } = body;

    if (!prompt) {
      return Response.json(
        { error: "Prompt is required" },
        { status: 400 }
      );
    }

    const genAI = getGeminiClient();
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash-exp",
    });

    const enhancedPrompt = buildImagePrompt(prompt, style, aspectRatio);

    // Generate image using Gemini
    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [{ text: enhancedPrompt }],
        },
      ],
      generationConfig: {
        responseModalities: ["image", "text"],
      } as any, // Type assertion for newer API features
    });

    const response = result.response;

    // Extract image from response
    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if ("inlineData" in part && part.inlineData) {
        const { data: base64Data, mimeType } = part.inlineData;

        // Determine file extension
        const ext = mimeType?.includes("png") ? "png" : "jpg";
        const fileName = `broll-${nanoid()}.${ext}`;
        const filePath = `uploads/${fileName}`;

        // Convert base64 to buffer
        const buffer = Buffer.from(base64Data, "base64");

        // Upload to S3
        const s3Client = getS3Client();
        const bucketName = process.env.REMOTION_S3_BUCKET || "remotionlambda-uploads";

        await s3Client.send(
          new PutObjectCommand({
            Bucket: bucketName,
            Key: filePath,
            Body: buffer,
            ContentType: mimeType || "image/jpeg",
          })
        );

        // Generate public URL
        const region = process.env.REMOTION_AWS_REGION || "us-east-1";
        const url = `https://${bucketName}.s3.${region}.amazonaws.com/${filePath}`;

        return Response.json({
          success: true,
          url,
          fileName,
          mimeType,
          prompt,
          style,
        });
      }
    }

    // If no image was generated, check for text response (error or explanation)
    const textResponse = response.text();
    return Response.json(
      {
        error: "No image was generated",
        details: textResponse,
      },
      { status: 500 }
    );
  } catch (error) {
    console.error("B-roll generation error:", error);

    return Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to generate B-roll",
      },
      { status: 500 }
    );
  }
}
