import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest } from "next/server";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
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
    photorealistic: "real photograph, stock photo style, natural lighting, taken with a professional camera, looks like a real photo from Getty Images or Shutterstock",
    cinematic: "cinematic photograph, real photo with dramatic lighting, shallow depth of field, looks like a frame from a documentary or film",
    minimalist: "clean real photograph, simple composition with negative space, modern and professional, real objects in real settings",
    // Legacy styles - redirect to realistic versions
    illustration: "real photograph, clean and modern, professional stock photo quality",
    abstract: "real photograph with artistic composition, interesting angles, real objects photographed creatively",
  };

  const aspectDescriptions: Record<string, string> = {
    "9:16": "vertical/portrait orientation for mobile video",
    "16:9": "horizontal/landscape orientation, widescreen",
    "1:1": "square format",
  };

  // Extract the core subject from the prompt and make it concrete
  return `Create a REALISTIC photograph for video B-roll.

Subject: ${basePrompt}

CRITICAL REQUIREMENTS:
1. This must look like a REAL PHOTOGRAPH - not AI art, not illustration, not conceptual
2. Show REAL, TANGIBLE objects that actually exist - things you could photograph in real life
3. Style: ${styleDescriptions[style] || styleDescriptions.photorealistic}
4. Looks like professional stock footage you'd find on Shutterstock or Getty Images
5. Natural, believable lighting - like a real camera captured this
6. ${aspectDescriptions[aspectRatio] || aspectDescriptions["9:16"]}

DO NOT:
- Create surreal, futuristic, or fantasy imagery
- Add glowing effects, neon, or sci-fi elements
- Make abstract or conceptual art
- Add any text, watermarks, or logos
- Create anything that looks obviously AI-generated

This B-roll will be inserted into a talking-head video, so it needs to look professional and realistic.`;
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

        // Generate a presigned URL for reading (valid for 7 days)
        const signedUrl = await getSignedUrl(
          s3Client,
          new GetObjectCommand({
            Bucket: bucketName,
            Key: filePath,
          }),
          { expiresIn: 60 * 60 * 24 * 7 } // 7 days
        );

        return Response.json({
          success: true,
          url: signedUrl,
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
