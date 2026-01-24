import { NextResponse } from "next/server";
import { getRenderProgress } from "@remotion/lambda/client";

const REGION = process.env.REMOTION_AWS_REGION || "us-east-1";
const FUNCTION_NAME = process.env.REMOTION_FUNCTION_NAME || "";

// Retry helper for Lambda rate limiting
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const isRateLimit = error?.name === "TooManyRequestsException" ||
        error?.Reason === "ConcurrentInvocationLimitExceeded";

      if (!isRateLimit || attempt === maxRetries) {
        throw error;
      }

      // Exponential backoff: 1s, 2s, 4s
      const delay = baseDelay * Math.pow(2, attempt);
      console.log(`[Rate limited] Retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error("Max retries exceeded");
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: renderId } = await params;
    const { searchParams } = new URL(request.url);
    const bucketName = searchParams.get("bucketName");

    if (!renderId) {
      return NextResponse.json(
        { message: "Render ID is required" },
        { status: 400 }
      );
    }

    if (!bucketName) {
      return NextResponse.json(
        { message: "bucketName query parameter is required" },
        { status: 400 }
      );
    }

    if (!FUNCTION_NAME) {
      return NextResponse.json(
        { message: "Lambda not configured. Set REMOTION_FUNCTION_NAME" },
        { status: 500 }
      );
    }

    const progress = await withRetry(() =>
      getRenderProgress({
        renderId,
        bucketName,
        functionName: FUNCTION_NAME,
        region: REGION as any,
      })
    );

    // Log full progress for debugging
    console.log("[Render Progress]", {
      renderId,
      overallProgress: progress.overallProgress,
      done: progress.done,
      fatalErrorEncountered: progress.fatalErrorEncountered,
      errors: progress.errors,
      renderSize: progress.renderSize,
      chunks: progress.chunks,
      outputFile: progress.outputFile,
    });

    // Map Lambda progress to the format use-download-state expects
    let status: string;
    if (progress.fatalErrorEncountered) {
      status = "FAILED";
    } else if (progress.done) {
      status = progress.errors && progress.errors.length > 0 ? "FAILED" : "COMPLETED";
    } else if (progress.overallProgress > 0) {
      status = "PROCESSING";
    } else {
      status = "PENDING";
    }

    return NextResponse.json({
      render: {
        id: renderId,
        status,
        progress: Math.round(progress.overallProgress * 100),
        presigned_url: progress.outputFile || null,
        errors: progress.errors || [],
        // Include extra debug info
        fatalErrorEncountered: progress.fatalErrorEncountered,
        chunks: progress.chunks,
        renderSize: progress.renderSize,
      }
    }, { status: 200 });

  } catch (error: any) {
    console.error("Progress check error:", error);

    return NextResponse.json(
      { message: "Failed to check render progress", error: String(error) },
      { status: 500 }
    );
  }
}
