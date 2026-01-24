import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { nanoid } from "nanoid";

const s3Client = new S3Client({
  region: process.env.REMOTION_AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.REMOTION_AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.REMOTION_AWS_SECRET_ACCESS_KEY || "",
  },
});

const BUCKET_NAME = process.env.REMOTION_S3_BUCKET || "remotionlambda-uploads";

function getContentTypeFromUrl(url: string): string {
  const ext = url.split(".").pop()?.toLowerCase()?.split("?")[0];
  const types: Record<string, string> = {
    mp4: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
  };
  return types[ext || ""] || "video/mp4";
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { urls } = body;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json(
        { error: "urls array is required" },
        { status: 400 }
      );
    }

    const uploads = await Promise.all(
      urls.map(async (url: string) => {
        // Fetch the file from URL
        const response = await fetch(url);
        const buffer = await response.arrayBuffer();

        const fileId = nanoid();
        const contentType = getContentTypeFromUrl(url);
        const ext = contentType.split("/")[1] === "quicktime" ? "mov" : contentType.split("/")[1];
        const filePath = `uploads/${fileId}.${ext}`;

        // Upload to S3
        await s3Client.send(
          new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: filePath,
            Body: Buffer.from(buffer),
            ContentType: contentType,
          })
        );

        const publicUrl = `https://${BUCKET_NAME}.s3.${process.env.REMOTION_AWS_REGION || "us-east-1"}.amazonaws.com/${filePath}`;

        return {
          fileName: filePath.split("/").pop(),
          filePath,
          contentType,
          originalUrl: url,
          url: publicUrl,
        };
      })
    );

    return NextResponse.json({ success: true, uploads });
  } catch (error) {
    console.error("Error uploading from URL:", error);
    return NextResponse.json(
      { error: "Failed to upload from URL", details: String(error) },
      { status: 500 }
    );
  }
}
