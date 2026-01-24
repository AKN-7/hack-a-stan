/**
 * Video Generation Service
 * Supports Gemini Veo for text-to-video and video extension
 * Can be extended with Runway API for additional capabilities
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { nanoid } from "nanoid";

// ============================================================================
// TYPES
// ============================================================================

export interface VideoGenerationRequest {
  prompt: string;
  style?: "cinematic" | "documentary" | "commercial" | "social-media" | "artistic" | "realistic";
  duration?: 4 | 6 | 8;
  aspectRatio?: "9:16" | "16:9" | "1:1";
  referenceImageUrl?: string;
  withAudio?: boolean;
}

export interface VideoGenerationResult {
  success: boolean;
  jobId?: string;
  status?: "pending" | "processing" | "completed" | "failed";
  videoUrl?: string;
  error?: string;
  estimatedTimeSeconds?: number;
}

export interface VideoExtensionRequest {
  sourceVideoUrl: string;
  direction: "before" | "after";
  durationSeconds: number;
  prompt?: string;
}

export interface VideoToVideoRequest {
  sourceVideoUrl: string;
  effect: "style-transfer" | "enhance" | "slow-motion" | "color-grade" | "anime-style" | "cartoon-style" | "cinematic-grade" | "vintage";
  prompt?: string;
  intensity?: number;
}

// ============================================================================
// GEMINI VEO CLIENT
// ============================================================================

const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY is required for video generation");
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

// ============================================================================
// PROMPT BUILDERS
// ============================================================================

function buildVideoPrompt(request: VideoGenerationRequest): string {
  const styleDescriptions: Record<string, string> = {
    cinematic: "cinematic quality, dramatic lighting, film grain, anamorphic lens, professional camera movement",
    documentary: "documentary style, natural lighting, observational camera, authentic feel",
    commercial: "commercial quality, polished, vibrant colors, dynamic camera movement, high production value",
    "social-media": "social media optimized, engaging, fast-paced, attention-grabbing, mobile-friendly",
    artistic: "artistic interpretation, creative visual style, unique perspective, expressive",
    realistic: "photorealistic, natural motion, lifelike, authentic details",
  };

  const aspectDescriptions: Record<string, string> = {
    "9:16": "vertical portrait format (9:16), optimized for mobile/TikTok/Reels",
    "16:9": "horizontal landscape format (16:9), widescreen",
    "1:1": "square format (1:1), versatile for social media",
  };

  const style = request.style || "cinematic";
  const aspectRatio = request.aspectRatio || "9:16";
  const duration = request.duration || 6;

  return `Generate a ${duration}-second video:

${request.prompt}

Style: ${styleDescriptions[style]}
Format: ${aspectDescriptions[aspectRatio]}
Duration: ${duration} seconds

Requirements:
- Smooth, natural motion
- Professional quality suitable for video production
- Engaging visual composition
- ${request.withAudio ? "Include synchronized ambient audio/sound effects" : "No audio needed"}`;
}

function buildExtensionPrompt(request: VideoExtensionRequest): string {
  const directionText = request.direction === "before"
    ? "Create footage that would naturally lead into"
    : "Create footage that naturally continues from";

  return `${directionText} the reference video.

${request.prompt || "Match the style, lighting, and mood of the reference video."}

Duration: ${request.durationSeconds} seconds
Ensure seamless visual continuity with the reference.`;
}

function buildVideoToVideoPrompt(request: VideoToVideoRequest): string {
  const effectDescriptions: Record<string, string> = {
    "style-transfer": `Apply this style: ${request.prompt || "cinematic color grading"}`,
    enhance: "Enhance video quality, improve sharpness, reduce noise, optimize colors",
    "slow-motion": "Convert to smooth slow-motion (2x slower), interpolate frames for fluid motion",
    "color-grade": `Apply professional color grading: ${request.prompt || "cinematic look with rich shadows and highlights"}`,
    "anime-style": "Transform into anime/animation style with cel-shading and stylized colors",
    "cartoon-style": "Transform into cartoon style with bold outlines and vibrant colors",
    "cinematic-grade": "Apply cinematic color grading with teal/orange palette, film grain, and dramatic contrast",
    vintage: "Apply vintage film look with grain, faded colors, light leaks, and vignette",
  };

  const intensity = request.intensity ?? 0.7;

  return `Transform this video with the following effect:

Effect: ${effectDescriptions[request.effect]}
Intensity: ${Math.round(intensity * 100)}%

Preserve the original motion and composition while applying the transformation.`;
}

// ============================================================================
// VIDEO GENERATION
// ============================================================================

/**
 * Generate a video using Gemini Veo
 * Note: This is a simplified implementation. In production, you'd use
 * the full Veo API with async job handling.
 */
export async function generateVideo(request: VideoGenerationRequest): Promise<VideoGenerationResult> {
  try {
    const genAI = getGeminiClient();

    // Use Gemini 2.0 Flash with video generation capability
    // Note: Veo video generation is available in preview
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash-exp",
    });

    const prompt = buildVideoPrompt(request);

    // Build the request with image reference if provided
    const contents: any[] = [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ];

    // If reference image is provided, include it
    if (request.referenceImageUrl) {
      // Fetch and encode the reference image
      try {
        const imageResponse = await fetch(request.referenceImageUrl);
        const imageBuffer = await imageResponse.arrayBuffer();
        const base64Image = Buffer.from(imageBuffer).toString("base64");
        const mimeType = imageResponse.headers.get("content-type") || "image/jpeg";

        contents[0].parts.unshift({
          inlineData: {
            mimeType,
            data: base64Image,
          },
        });
        contents[0].parts[1].text = `Using this reference image for style:\n\n${prompt}`;
      } catch (e) {
        console.warn("Failed to fetch reference image, proceeding without it:", e);
      }
    }

    // Request video generation
    const result = await model.generateContent({
      contents,
      generationConfig: {
        responseModalities: ["video", "text"],
      } as any,
    });

    const response = result.response;

    // Check for video in response
    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if ("inlineData" in part && part.inlineData) {
        const { data: base64Data, mimeType } = part.inlineData;

        // Check if it's a video
        if (mimeType?.startsWith("video/")) {
          // Upload to S3
          const fileName = `generated-video-${nanoid()}.mp4`;
          const filePath = `videos/${fileName}`;
          const buffer = Buffer.from(base64Data, "base64");

          const s3Client = getS3Client();
          const bucketName = process.env.REMOTION_S3_BUCKET || "remotionlambda-uploads";

          await s3Client.send(
            new PutObjectCommand({
              Bucket: bucketName,
              Key: filePath,
              Body: buffer,
              ContentType: mimeType,
            })
          );

          const region = process.env.REMOTION_AWS_REGION || "us-east-1";
          const videoUrl = `https://${bucketName}.s3.${region}.amazonaws.com/${filePath}`;

          return {
            success: true,
            status: "completed",
            videoUrl,
          };
        }
      }
    }

    // If no video was generated, return status
    const textResponse = response.text();

    // Check if it's an async job
    if (textResponse.includes("job") || textResponse.includes("pending")) {
      return {
        success: true,
        status: "processing",
        estimatedTimeSeconds: 60,
        error: textResponse,
      };
    }

    return {
      success: false,
      status: "failed",
      error: `Video generation not available or failed: ${textResponse}`,
    };
  } catch (error) {
    console.error("Video generation error:", error);
    return {
      success: false,
      status: "failed",
      error: error instanceof Error ? error.message : "Video generation failed",
    };
  }
}

/**
 * Extend an existing video
 */
export async function extendVideo(request: VideoExtensionRequest): Promise<VideoGenerationResult> {
  try {
    const genAI = getGeminiClient();
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash-exp",
    });

    // Fetch the source video for reference
    const prompt = buildExtensionPrompt(request);

    // For extension, we'd ideally send the last/first frame as reference
    // This is a simplified version
    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            { text: `Reference video URL: ${request.sourceVideoUrl}\n\n${prompt}` },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ["video", "text"],
      } as any,
    });

    const response = result.response;

    // Handle video response similar to generateVideo
    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if ("inlineData" in part && part.inlineData?.mimeType?.startsWith("video/")) {
        const { data: base64Data, mimeType } = part.inlineData;

        const fileName = `extended-video-${nanoid()}.mp4`;
        const filePath = `videos/${fileName}`;
        const buffer = Buffer.from(base64Data, "base64");

        const s3Client = getS3Client();
        const bucketName = process.env.REMOTION_S3_BUCKET!;

        await s3Client.send(
          new PutObjectCommand({
            Bucket: bucketName,
            Key: filePath,
            Body: buffer,
            ContentType: mimeType,
          })
        );

        const region = process.env.REMOTION_AWS_REGION || "us-east-1";
        const videoUrl = `https://${bucketName}.s3.${region}.amazonaws.com/${filePath}`;

        return {
          success: true,
          status: "completed",
          videoUrl,
        };
      }
    }

    return {
      success: false,
      status: "failed",
      error: "Video extension not available",
    };
  } catch (error) {
    console.error("Video extension error:", error);
    return {
      success: false,
      status: "failed",
      error: error instanceof Error ? error.message : "Video extension failed",
    };
  }
}

/**
 * Apply video-to-video transformation
 */
export async function transformVideo(request: VideoToVideoRequest): Promise<VideoGenerationResult> {
  try {
    const genAI = getGeminiClient();
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash-exp",
    });

    const prompt = buildVideoToVideoPrompt(request);

    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            { text: `Transform this video: ${request.sourceVideoUrl}\n\n${prompt}` },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ["video", "text"],
      } as any,
    });

    const response = result.response;

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if ("inlineData" in part && part.inlineData?.mimeType?.startsWith("video/")) {
        const { data: base64Data, mimeType } = part.inlineData;

        const fileName = `transformed-video-${nanoid()}.mp4`;
        const filePath = `videos/${fileName}`;
        const buffer = Buffer.from(base64Data, "base64");

        const s3Client = getS3Client();
        const bucketName = process.env.REMOTION_S3_BUCKET!;

        await s3Client.send(
          new PutObjectCommand({
            Bucket: bucketName,
            Key: filePath,
            Body: buffer,
            ContentType: mimeType,
          })
        );

        const region = process.env.REMOTION_AWS_REGION || "us-east-1";
        const videoUrl = `https://${bucketName}.s3.${region}.amazonaws.com/${filePath}`;

        return {
          success: true,
          status: "completed",
          videoUrl,
        };
      }
    }

    return {
      success: false,
      status: "failed",
      error: "Video transformation not available",
    };
  } catch (error) {
    console.error("Video transformation error:", error);
    return {
      success: false,
      status: "failed",
      error: error instanceof Error ? error.message : "Video transformation failed",
    };
  }
}

// ============================================================================
// RUNWAY API INTEGRATION (Optional - requires API key)
// ============================================================================

interface RunwayJobResponse {
  id: string;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  output?: string[];
  failure?: string;
}

/**
 * Generate video using Runway Gen-4 API
 * This provides higher quality results but requires a Runway API subscription
 */
export async function generateVideoWithRunway(request: VideoGenerationRequest): Promise<VideoGenerationResult> {
  const apiKey = process.env.RUNWAY_API_KEY;

  if (!apiKey) {
    // Fall back to Gemini Veo
    console.log("RUNWAY_API_KEY not set, falling back to Gemini Veo");
    return generateVideo(request);
  }

  try {
    // Submit generation job
    const response = await fetch("https://api.dev.runwayml.com/v1/image_to_video", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Runway-Version": "2024-11-06",
      },
      body: JSON.stringify({
        promptText: buildVideoPrompt(request),
        model: "gen4_turbo",
        duration: request.duration || 5,
        ratio: request.aspectRatio === "16:9" ? "16:9" : request.aspectRatio === "1:1" ? "1:1" : "9:16",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Runway API error: ${response.status} - ${errorText}`);
    }

    const job = await response.json() as RunwayJobResponse;

    return {
      success: true,
      jobId: job.id,
      status: "processing",
      estimatedTimeSeconds: 120,
    };
  } catch (error) {
    console.error("Runway generation error:", error);
    // Fall back to Gemini
    return generateVideo(request);
  }
}

/**
 * Check Runway job status
 */
export async function checkRunwayJobStatus(jobId: string): Promise<VideoGenerationResult> {
  const apiKey = process.env.RUNWAY_API_KEY;

  if (!apiKey) {
    return {
      success: false,
      status: "failed",
      error: "RUNWAY_API_KEY not configured",
    };
  }

  try {
    const response = await fetch(`https://api.dev.runwayml.com/v1/tasks/${jobId}`, {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "X-Runway-Version": "2024-11-06",
      },
    });

    if (!response.ok) {
      throw new Error(`Runway status check failed: ${response.status}`);
    }

    const job = await response.json() as RunwayJobResponse;

    if (job.status === "SUCCEEDED" && job.output?.[0]) {
      // Download and upload to S3
      const videoResponse = await fetch(job.output[0]);
      const videoBuffer = await videoResponse.arrayBuffer();

      const fileName = `runway-video-${nanoid()}.mp4`;
      const filePath = `videos/${fileName}`;

      const s3Client = getS3Client();
      const bucketName = process.env.REMOTION_S3_BUCKET!;

      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: filePath,
          Body: Buffer.from(videoBuffer),
          ContentType: "video/mp4",
        })
      );

      const region = process.env.REMOTION_AWS_REGION || "us-east-1";
      const videoUrl = `https://${bucketName}.s3.${region}.amazonaws.com/${filePath}`;

      return {
        success: true,
        status: "completed",
        videoUrl,
      };
    }

    if (job.status === "FAILED") {
      return {
        success: false,
        status: "failed",
        error: job.failure || "Video generation failed",
      };
    }

    return {
      success: true,
      jobId,
      status: "processing",
    };
  } catch (error) {
    console.error("Runway status check error:", error);
    return {
      success: false,
      status: "failed",
      error: error instanceof Error ? error.message : "Status check failed",
    };
  }
}
