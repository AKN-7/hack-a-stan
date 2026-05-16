import axios from "axios";

export type UploadProgressCallback = (
  uploadId: string,
  progress: number
) => void;

export type UploadStatusCallback = (
  uploadId: string,
  status: "uploaded" | "failed",
  error?: string
) => void;

export interface UploadCallbacks {
  onProgress: UploadProgressCallback;
  onStatus: UploadStatusCallback;
}

export async function processFileUpload(
  uploadId: string,
  file: File,
  callbacks: UploadCallbacks
): Promise<any> {
  try {
    // Step 1: Get presigned URL from our API (small request, no file data)
    callbacks.onProgress(uploadId, 5);
    const { data: presignData } = await axios.post("/api/uploads/presign", {
      fileNames: [file.name],
    });

    if (!presignData.success || !presignData.uploads?.[0]) {
      throw new Error("Failed to get upload URL");
    }

    const uploadInfo = presignData.uploads[0];

    // Step 2: Upload directly to S3 using presigned URL (bypasses Vercel's 4.5MB limit).
    // Headers must match PutObjectCommand in /api/uploads/presign exactly (no ACL — works with BucketOwnerEnforced).
    await axios.put(uploadInfo.presignedUrl, file, {
      headers: {
        "Content-Type": uploadInfo.contentType,
      },
      onUploadProgress: (progressEvent) => {
        // Map progress from 5-95% (reserving 0-5% for presign, 95-100% for completion)
        const percent = 5 + Math.round(
          (progressEvent.loaded * 90) / (progressEvent.total || 1)
        );
        callbacks.onProgress(uploadId, percent);
      },
    });

    callbacks.onProgress(uploadId, 100);

    const uploadData = {
      fileName: file.name,
      filePath: uploadInfo.filePath,
      fileSize: file.size,
      contentType: uploadInfo.contentType,
      metadata: { uploadedUrl: uploadInfo.url },
      folder: null,
      type: uploadInfo.contentType.split("/")[0],
      method: "presigned",
      origin: "user",
      status: "uploaded",
      isPreview: false,
    };

    callbacks.onStatus(uploadId, "uploaded");
    return uploadData;
  } catch (error) {
    console.error("Upload failed:", error);
    callbacks.onStatus(uploadId, "failed", (error as Error).message);
    throw error;
  }
}

export async function processUrlUpload(
  uploadId: string,
  url: string,
  callbacks: UploadCallbacks
): Promise<any[]> {
  try {
    callbacks.onProgress(uploadId, 10);

    const { data } = await axios.post(
      "/api/uploads/url",
      { urls: [url] },
      { headers: { "Content-Type": "application/json" } }
    );

    callbacks.onProgress(uploadId, 50);

    const uploadDataArray = (data.uploads || []).map((uploadInfo: any) => ({
      fileName: uploadInfo.fileName,
      filePath: uploadInfo.filePath,
      fileSize: 0,
      contentType: uploadInfo.contentType,
      metadata: { originalUrl: uploadInfo.originalUrl, uploadedUrl: uploadInfo.url },
      folder: null,
      type: uploadInfo.contentType.split("/")[0],
      method: "url",
      origin: "user",
      status: "uploaded",
      isPreview: false,
    }));

    callbacks.onProgress(uploadId, 100);
    callbacks.onStatus(uploadId, "uploaded");
    return uploadDataArray;
  } catch (error) {
    callbacks.onStatus(uploadId, "failed", (error as Error).message);
    throw error;
  }
}

export async function processUpload(
  uploadId: string,
  upload: { file?: File; url?: string },
  callbacks: UploadCallbacks
): Promise<any> {
  if (upload.file) {
    return await processFileUpload(uploadId, upload.file, callbacks);
  }
  if (upload.url) {
    return await processUrlUpload(uploadId, upload.url, callbacks);
  }
  callbacks.onStatus(uploadId, "failed", "No file or URL provided");
  throw new Error("No file or URL provided");
}
