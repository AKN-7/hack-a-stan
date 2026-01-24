import { NextRequest, NextResponse } from "next/server";
import {
  generateVideo,
  extendVideo,
  transformVideo,
  generateVideoWithRunway,
  checkRunwayJobStatus,
  VideoGenerationRequest,
  VideoExtensionRequest,
  VideoToVideoRequest,
} from "@/features/chat/video-generation-service";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    // Route to appropriate handler based on action
    switch (action) {
      case "extend": {
        const extensionRequest: VideoExtensionRequest = {
          sourceVideoUrl: body.sourceVideoUrl,
          direction: body.direction,
          durationSeconds: body.durationSeconds || 4,
          prompt: body.prompt,
        };

        const result = await extendVideo(extensionRequest);

        if (!result.success) {
          return NextResponse.json(
            { message: result.error || "Video extension failed" },
            { status: 500 }
          );
        }

        return NextResponse.json({
          success: true,
          videoUrl: result.videoUrl,
          status: result.status,
          jobId: result.jobId,
          estimatedTimeSeconds: result.estimatedTimeSeconds,
        });
      }

      case "transform": {
        const transformRequest: VideoToVideoRequest = {
          sourceVideoUrl: body.sourceVideoUrl,
          effect: body.effect,
          prompt: body.prompt,
          intensity: body.intensity,
        };

        const result = await transformVideo(transformRequest);

        if (!result.success) {
          return NextResponse.json(
            { message: result.error || "Video transformation failed" },
            { status: 500 }
          );
        }

        return NextResponse.json({
          success: true,
          videoUrl: result.videoUrl,
          status: result.status,
          jobId: result.jobId,
        });
      }

      case "check-status": {
        const { jobId } = body;
        if (!jobId) {
          return NextResponse.json(
            { message: "jobId is required for status check" },
            { status: 400 }
          );
        }

        const result = await checkRunwayJobStatus(jobId);

        return NextResponse.json({
          success: result.success,
          videoUrl: result.videoUrl,
          status: result.status,
          error: result.error,
        });
      }

      default: {
        // Default action: generate new video
        const generateRequest: VideoGenerationRequest = {
          prompt: body.prompt,
          style: body.style || "cinematic",
          duration: body.duration || 6,
          aspectRatio: body.aspectRatio || "9:16",
          referenceImageUrl: body.referenceImageUrl,
          withAudio: body.withAudio,
        };

        if (!generateRequest.prompt) {
          return NextResponse.json(
            { message: "prompt is required for video generation" },
            { status: 400 }
          );
        }

        // Try Runway first if API key is available, otherwise use Gemini Veo
        const useRunway = !!process.env.RUNWAY_API_KEY;
        const result = useRunway
          ? await generateVideoWithRunway(generateRequest)
          : await generateVideo(generateRequest);

        if (!result.success) {
          return NextResponse.json(
            { message: result.error || "Video generation failed" },
            { status: 500 }
          );
        }

        return NextResponse.json({
          success: true,
          videoUrl: result.videoUrl,
          status: result.status,
          jobId: result.jobId,
          estimatedTimeSeconds: result.estimatedTimeSeconds,
        });
      }
    }
  } catch (error) {
    console.error("Video generation API error:", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Video generation failed" },
      { status: 500 }
    );
  }
}

// GET endpoint for checking job status
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const jobId = searchParams.get("jobId");

  if (!jobId) {
    return NextResponse.json(
      { message: "jobId query parameter is required" },
      { status: 400 }
    );
  }

  try {
    const result = await checkRunwayJobStatus(jobId);

    return NextResponse.json({
      success: result.success,
      videoUrl: result.videoUrl,
      status: result.status,
      error: result.error,
    });
  } catch (error) {
    console.error("Job status check error:", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Status check failed" },
      { status: 500 }
    );
  }
}
