import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { nanoid } from "nanoid";

const s3Client = new S3Client({
  region: process.env.REMOTION_AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.REMOTION_AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.REMOTION_AWS_SECRET_ACCESS_KEY || "",
  },
});

const BUCKET_NAME = process.env.REMOTION_S3_BUCKET || "remotionlambda-uploads";

function getContentType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  const types: Record<string, string> = {
    mp4: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    mkv: "video/x-matroska",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    m4a: "audio/mp4",
    aac: "audio/aac",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
  };
  return types[ext || ""] || "application/octet-stream";
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { fileNames } = body;

    if (!fileNames || !Array.isArray(fileNames) || fileNames.length === 0) {
      return NextResponse.json(
        { error: "fileNames array is required" },
        { status: 400 }
      );
    }

    const uploads = await Promise.all(
      fileNames.map(async (fileName: string) => {
        const fileId = nanoid();
        const ext = fileName.split(".").pop();
        const filePath = `uploads/${fileId}.${ext}`;
        const contentType = getContentType(fileName);

        const putCommand = new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: filePath,
          ContentType: contentType,
        });

        const presignedUrl = await getSignedUrl(s3Client, putCommand, {
          expiresIn: 3600, // 1 hour
        });

        // Readable URL for browsers / transcription APIs (private bucket; no object ACLs).
        const readUrl = await getSignedUrl(
          s3Client,
          new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: filePath,
          }),
          { expiresIn: 60 * 60 * 24 * 7 } // 7 days — matches POST /api/uploads
        );

        return {
          fileName,
          filePath,
          contentType,
          presignedUrl,
          url: readUrl,
        };
      })
    );

    return NextResponse.json({ success: true, uploads });
  } catch (error) {
    console.error("Error generating presigned URL:", error);
    return NextResponse.json(
      { error: "Failed to generate upload URL", details: String(error) },
      { status: 500 }
    );
  }
}
