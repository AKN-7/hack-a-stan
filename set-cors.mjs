import { S3Client, PutBucketCorsCommand } from "@aws-sdk/client-s3";
import { config } from "dotenv";

// Load environment variables from .env
config();

const client = new S3Client({
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.REMOTION_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.REMOTION_AWS_SECRET_ACCESS_KEY,
  },
});

const command = new PutBucketCorsCommand({
  Bucket: process.env.REMOTION_S3_BUCKET,
  CORSConfiguration: {
    CORSRules: [
      {
        AllowedHeaders: ["*"],
        AllowedMethods: ["GET", "PUT", "POST", "HEAD"],
        AllowedOrigins: ["*"],
        ExposeHeaders: ["ETag"],
      },
    ],
  },
});

try {
  await client.send(command);
  console.log("CORS configured successfully!");
} catch (err) {
  console.error("Error:", err);
}
