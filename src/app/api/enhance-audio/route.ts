import { NextRequest, NextResponse } from "next/server";
import { Cleanvoice } from "@cleanvoice/cleanvoice-sdk";

// Initialize CleanVoice client
const getCleanvoiceClient = () => {
  const apiKey = process.env.CLEANVOICE_API_KEY;
  if (!apiKey) {
    throw new Error("CLEANVOICE_API_KEY environment variable is not set");
  }
  return new Cleanvoice({ apiKey });
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { clipId, sourceUrl, options } = body;

    if (!sourceUrl) {
      return NextResponse.json(
        { error: "sourceUrl is required" },
        { status: 400 }
      );
    }

    if (!clipId) {
      return NextResponse.json(
        { error: "clipId is required" },
        { status: 400 }
      );
    }

    const cv = getCleanvoiceClient();

    // Start enhancement job with CleanVoice
    // Uses noise reduction + loudness normalization by default
    const editOptions = {
      remove_noise: options?.noiseReduction ?? true,
      normalize: options?.loudnessNormalization ?? true,
      studio_sound: "nightly" as const, // Best quality processing
      // Don't remove filler words - we have our own AI for that
      fillers: false,
      stutters: false,
      mouth_sounds: false,
      long_silences: false,
    };

    console.log("[Enhance Audio] Starting job for clip:", clipId, {
      sourceUrl: sourceUrl.substring(0, 100) + "...",
      options: editOptions,
    });

    const editId = await cv.createEdit(sourceUrl, editOptions);

    console.log("[Enhance Audio] Job created:", editId);

    return NextResponse.json({
      success: true,
      jobId: editId,
      clipId,
      status: "pending",
    });
  } catch (error) {
    console.error("[Enhance Audio] Error starting job:", error);

    // Handle specific error types
    if (error instanceof Error && error.message.includes("CLEANVOICE_API_KEY")) {
      return NextResponse.json(
        { error: "CleanVoice API not configured" },
        { status: 503 }
      );
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to start audio enhancement",
      },
      { status: 500 }
    );
  }
}
