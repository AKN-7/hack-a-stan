import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { nanoid } from "nanoid";

// Allow large file uploads (500MB max)
export const config = {
  api: {
    bodyParser: false,
  },
};

export const maxDuration = 60; // 60 second timeout

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
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
  };
  return types[ext || ""] || "application/octet-stream";
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const fileId = nanoid();
    const ext = file.name.split(".").pop();
    const filePath = `uploads/${fileId}.${ext}`;
    const contentType = getContentType(file.name);

    // Convert file to buffer
    const buffer = Buffer.from(await file.arrayBuffer());

    // Upload to S3 (private, will use presigned URLs for access)
    await s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: filePath,
        Body: buffer,
        ContentType: contentType,
      })
    );

    // Generate a presigned URL for reading (valid for 7 days)
    const signedUrl = await getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: filePath,
      }),
      { expiresIn: 60 * 60 * 24 * 7 } // 7 days
    );

    return NextResponse.json({
      success: true,
      upload: {
        fileName: file.name,
        filePath,
        contentType,
        url: signedUrl,
        fileSize: file.size,
      },
    });
  } catch (error) {
    console.error("Error uploading file:", error);
    return NextResponse.json(
      { error: "Failed to upload file", details: String(error) },
      { status: 500 }
    );
  }
}
