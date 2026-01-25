import { NextRequest, NextResponse } from "next/server";
import { Cleanvoice, EditResult, ProcessingProgress } from "@cleanvoice/cleanvoice-sdk";
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Type guard to check if result is EditResult (has download_url)
function isEditResult(result: ProcessingProgress | EditResult | undefined): result is EditResult {
  return result !== undefined && "download_url" in result;
}

// In-memory cache for completed jobs (prevents re-processing on rapid polls)
const completedJobsCache = new Map<string, { enhancedUrl: string; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Initialize CleanVoice client
const getCleanvoiceClient = () => {
  const apiKey = process.env.CLEANVOICE_API_KEY;
  if (!apiKey) {
    throw new Error("CLEANVOICE_API_KEY environment variable is not set");
  }
  return new Cleanvoice({ apiKey });
};

// Initialize S3 client
const s3Client = new S3Client({
  region: process.env.REMOTION_AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.REMOTION_AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.REMOTION_AWS_SECRET_ACCESS_KEY || "",
  },
});

const BUCKET_NAME = process.env.REMOTION_S3_BUCKET || "remotionlambda-uploads";

/**
 * Downloads the enhanced audio from CleanVoice and uploads it to our S3 bucket
 * Uses deterministic file path based on jobId to avoid duplicate uploads
 */
async function uploadEnhancedToS3(
  downloadUrl: string,
  clipId: string,
  jobId: string
): Promise<string> {
  // Use deterministic file path based on jobId
  const filePath = `enhanced/${clipId}/${jobId}.mp4`;

  // Check if file already exists in S3 (prevent duplicate uploads)
  try {
    await s3Client.send(
      new HeadObjectCommand({
        Bucket: BUCKET_NAME,
        Key: filePath,
      })
    );
    console.log("[Enhance Audio] File already exists in S3, generating URL:", filePath);
    // File exists, just generate a new signed URL
    const signedUrl = await getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: filePath,
      }),
      { expiresIn: 60 * 60 * 24 * 7 } // 7 days
    );
    return signedUrl;
  } catch {
    // File doesn't exist, continue with upload
  }

  // Download the enhanced audio from CleanVoice
  console.log("[Enhance Audio] Downloading from CleanVoice:", downloadUrl.substring(0, 80));
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`Failed to download enhanced audio: ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") || "video/mp4";

  console.log("[Enhance Audio] Uploading enhanced file to S3:", filePath, "size:", buffer.length);

  // Upload to S3
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: filePath,
      Body: buffer,
      ContentType: contentType,
    })
  );
  console.log("[Enhance Audio] S3 upload complete:", filePath);

  // Generate presigned URL for reading (valid for 7 days)
  const signedUrl = await getSignedUrl(
    s3Client,
    new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: filePath,
    }),
    { expiresIn: 60 * 60 * 24 * 7 } // 7 days
  );

  console.log("[Enhance Audio] Generated signed URL:", signedUrl.substring(0, 80) + "...");
  return signedUrl;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    const { searchParams } = new URL(request.url);
    const clipId = searchParams.get("clipId");

    if (!jobId) {
      return NextResponse.json(
        { error: "jobId is required" },
        { status: 400 }
      );
    }

    // Check in-memory cache first (prevents re-processing on rapid polls)
    const cached = completedJobsCache.get(jobId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      console.log("[Enhance Audio] Returning cached result for job:", jobId);
      return NextResponse.json({
        jobId,
        clipId,
        status: "completed",
        enhancedUrl: cached.enhancedUrl,
      });
    }

    const cv = getCleanvoiceClient();

    // Get the current status from CleanVoice
    const edit = await cv.getEdit(jobId);

    // Check if result is an EditResult (completed) or ProcessingProgress (in progress)
    const editResult = isEditResult(edit.result) ? edit.result : undefined;

    console.log("[Enhance Audio] Job status:", {
      jobId,
      status: edit.status,
      hasDownloadUrl: !!editResult?.download_url,
    });

    // Map CleanVoice status to our status
    // CleanVoice uses: PENDING, STARTED, RETRY, SUCCESS, FAILURE
    if (edit.status === "SUCCESS" && editResult?.download_url) {
      // Enhancement complete - download and upload to our S3
      try {
        const enhancedUrl = await uploadEnhancedToS3(
          editResult.download_url,
          clipId || jobId,
          jobId
        );

        // Cache the result
        completedJobsCache.set(jobId, { enhancedUrl, timestamp: Date.now() });

        console.log("[Enhance Audio] Returning completed status with URL for clip:", clipId);
        return NextResponse.json({
          jobId,
          clipId,
          status: "completed",
          enhancedUrl,
          statistics: editResult.statistics, // Include processing stats if available
        });
      } catch (uploadError) {
        console.error("[Enhance Audio] S3 upload error:", uploadError);
        return NextResponse.json({
          jobId,
          clipId,
          status: "failed",
          error: "Failed to save enhanced audio",
        });
      }
    }

    if (edit.status === "FAILURE") {
      return NextResponse.json({
        jobId,
        clipId,
        status: "failed",
        error: "Audio enhancement failed",
      });
    }

    // Still processing
    return NextResponse.json({
      jobId,
      clipId,
      status: "processing",
      // CleanVoice doesn't provide progress percentage, but we can estimate based on status
      progress: edit.status === "STARTED" ? 50 : 10,
    });
  } catch (error) {
    console.error("[Enhance Audio] Error checking status:", error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to check enhancement status",
      },
      { status: 500 }
    );
  }
}
