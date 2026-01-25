import { NextResponse } from "next/server";
import { renderMediaOnLambda } from "@remotion/lambda/client";

const REGION = process.env.REMOTION_AWS_REGION || "us-east-1";
const FUNCTION_NAME = process.env.REMOTION_FUNCTION_NAME || "";
const SERVE_URL = process.env.REMOTION_SERVE_URL || "";

// Extract text overlays from design payload
interface TextOverlay {
  id: string;
  text: string;
  fromMs: number;
  toMs: number;
  top?: number;
  left?: number;
  width?: number;
  height?: number;
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: string | number;
  color?: string;
  textAlign?: string;
  lineHeight?: string;
  letterSpacing?: string;
  textTransform?: string;
  opacity?: number;
  rotate?: string;
  borderWidth?: number;
  borderColor?: string;
  boxShadow?: {
    x: number;
    y: number;
    blur: number;
    color: string;
  };
}

function extractTextOverlays(design: any): TextOverlay[] {
  if (!design?.trackItemsMap) return [];

  const textOverlays: TextOverlay[] = [];

  for (const [id, item] of Object.entries(design.trackItemsMap)) {
    const trackItem = item as any;
    if (trackItem.type !== "text") continue;

    const details = trackItem.details || {};
    const display = trackItem.display || {};

    textOverlays.push({
      id,
      text: details.text || "",
      fromMs: display.from || 0,
      toMs: display.to || 0,
      top: details.top,
      left: details.left,
      width: details.width,
      height: details.height,
      fontFamily: details.fontFamily,
      fontSize: details.fontSize,
      fontWeight: details.fontWeight,
      color: details.color,
      textAlign: details.textAlign,
      lineHeight: details.lineHeight,
      letterSpacing: details.letterSpacing,
      textTransform: details.textTransform,
      opacity: details.opacity,
      rotate: details.rotate,
      borderWidth: details.borderWidth,
      borderColor: details.borderColor,
      boxShadow: details.boxShadow,
    });
  }

  return textOverlays;
}

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
      transitionSettings,
    } = body;

    // Extract text overlays from design
    const textOverlays = extractTextOverlays(design);

    // Debug logging
    console.log("[Render Request]", {
      hasTranscriptSegments: !!transcriptSegments,
      segmentCount: transcriptSegments?.length || 0,
      transcriptDurationMs,
      firstSegment: transcriptSegments?.[0],
      fps: options?.fps,
      textOverlayCount: textOverlays.length,
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
        // Text overlays extracted from design
        textOverlays,
        // Design props (for overlays like text, captions)
        design,
        // Transition settings for cross-dissolve smoothing
        transitionSettings: transitionSettings ?? { enabled: false, type: "fade", durationMs: 150 },
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
