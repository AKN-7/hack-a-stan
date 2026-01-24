import { NextResponse } from "next/server";
import { renderMediaOnLambda } from "@remotion/lambda/client";

const REGION = process.env.REMOTION_AWS_REGION || "us-east-1";
const FUNCTION_NAME = process.env.REMOTION_FUNCTION_NAME || "";
const SERVE_URL = process.env.REMOTION_SERVE_URL || "";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      clips,
      composition = "CaptionedVideo",
      transcriptSegments,
      transcriptDurationMs,
      captions,
      design,
      options,
    } = body;

    // Debug logging
    console.log("[Render Request]", {
      hasTranscriptSegments: !!transcriptSegments,
      segmentCount: transcriptSegments?.length || 0,
      transcriptDurationMs,
      firstSegment: transcriptSegments?.[0],
      fps: options?.fps,
    });

    if (!FUNCTION_NAME || !SERVE_URL) {
      return NextResponse.json(
        { message: "Lambda not configured. Set REMOTION_FUNCTION_NAME and REMOTION_SERVE_URL" },
        { status: 500 }
      );
    }

    // Determine which composition to use
    // If we have transcript segments, use TranscriptVideo composition
    const useTranscriptMode = transcriptSegments && transcriptSegments.length > 0;
    const targetComposition = useTranscriptMode ? "TranscriptVideo" : composition;

    // Calculate duration in frames
    const fps = options?.fps || 30;
    const durationInFrames = useTranscriptMode
      ? Math.ceil((transcriptDurationMs / 1000) * fps)
      : undefined;

    const { renderId, bucketName } = await renderMediaOnLambda({
      region: REGION as any,
      functionName: FUNCTION_NAME,
      serveUrl: SERVE_URL,
      composition: targetComposition,
      codec: "h264",
      // Reduce parallel Lambda invocations to avoid concurrency limits
      framesPerLambda: 120, // ~4 seconds of video per Lambda at 30fps
      inputProps: {
        clips,
        // Transcript-driven props
        segments: transcriptSegments,
        durationMs: transcriptDurationMs,
        captions: captions || [],
        fps,
        // Design props (for overlays like text, captions)
        design,
      },
      // Override duration if using transcript segments
      ...(durationInFrames ? { durationInFrames } : {}),
    });

    // Return format that matches what use-download-state expects
    return NextResponse.json({
      render: {
        id: renderId,
        bucketName: bucketName,
        status: "PENDING",
      },
      mode: useTranscriptMode ? "transcript" : "standard",
    }, { status: 200 });

  } catch (error) {
    console.error("Render error:", error);
    return NextResponse.json(
      { message: "Failed to start render", error: String(error) },
      { status: 500 }
    );
  }
}
