"use client";

import { useState, useCallback, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, Sparkles, Video, Check } from "lucide-react";
import useUploadStore from "./store/use-upload-store";

interface UploadWithThumbnail {
  id: string;
  file: File;
  thumbnail: string | null;
  progress: number;
  status: "pending" | "uploading" | "uploaded" | "failed";
}

const UploadLanding = () => {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadsWithThumbnails, setUploadsWithThumbnails] = useState<UploadWithThumbnail[]>([]);
  const { addPendingUploads, processUploads, activeUploads, pendingUploads } = useUploadStore();

  const isUploading = activeUploads.length > 0 || pendingUploads.length > 0 || uploadsWithThumbnails.length > 0;

  // Sync progress from upload store to our thumbnail state
  useEffect(() => {
    if (uploadsWithThumbnails.length === 0) return;

    setUploadsWithThumbnails(prev => prev.map(upload => {
      const active = activeUploads.find(a => a.id === upload.id);
      if (active) {
        return {
          ...upload,
          progress: active.progress || 0,
          status: active.status || "uploading",
        };
      }
      // Check if upload completed (no longer in active)
      const stillPending = pendingUploads.find(p => p.id === upload.id);
      if (!stillPending && !active && upload.status === "uploading") {
        return { ...upload, progress: 100, status: "uploaded" };
      }
      return upload;
    }));
  }, [activeUploads, pendingUploads]);

  // Generate video thumbnail
  const generateThumbnail = (file: File): Promise<string | null> => {
    return new Promise((resolve) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.muted = true;
      video.playsInline = true;

      video.onloadeddata = () => {
        video.currentTime = 1; // Seek to 1 second
      };

      video.onseeked = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 160;
        canvas.height = 90;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.7));
        } else {
          resolve(null);
        }
        URL.revokeObjectURL(video.src);
      };

      video.onerror = () => {
        resolve(null);
        URL.revokeObjectURL(video.src);
      };

      video.src = URL.createObjectURL(file);
    });
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;

    // Filter for video files
    const videoFiles = acceptedFiles.filter(f => f.type.startsWith("video/"));

    if (videoFiles.length === 0) {
      return;
    }

    // Create upload entries with IDs
    const uploadEntries: UploadWithThumbnail[] = videoFiles.map(file => ({
      id: crypto.randomUUID(),
      file,
      thumbnail: null,
      progress: 0,
      status: "pending" as const,
    }));

    // Set initial state immediately
    setUploadsWithThumbnails(uploadEntries);

    // Generate thumbnails in parallel
    const thumbnailPromises = uploadEntries.map(async (entry) => {
      const thumbnail = await generateThumbnail(entry.file);
      return { id: entry.id, thumbnail };
    });

    // Update thumbnails as they complete
    thumbnailPromises.forEach(async (promise) => {
      const { id, thumbnail } = await promise;
      setUploadsWithThumbnails(prev =>
        prev.map(u => u.id === id ? { ...u, thumbnail } : u)
      );
    });

    // Add to upload store and process
    const uploads = uploadEntries.map(entry => ({
      id: entry.id,
      file: entry.file,
      type: entry.file.type,
      status: "pending" as const,
    }));

    addPendingUploads(uploads);
    processUploads();
  }, [addPendingUploads, processUploads]);

  const { getRootProps, getInputProps, open } = useDropzone({
    onDrop,
    accept: {
      "video/*": [".mp4", ".mov", ".webm", ".mkv", ".avi"],
    },
    noClick: true,
    onDragEnter: () => setIsDragging(true),
    onDragLeave: () => setIsDragging(false),
  });

  return (
    <div
      {...getRootProps()}
      className={`
        fixed inset-0 z-50 flex items-center justify-center
        bg-gradient-to-br from-zinc-950 via-zinc-900 to-black
        transition-all duration-300 safe-area-inset
        ${isDragging ? "bg-primary/5" : ""}
      `}
    >
      <input {...getInputProps()} />

      {/* Main content */}
      <div className="flex flex-col items-center justify-center gap-6 md:gap-8 p-4 md:p-8 max-w-2xl text-center w-full">
        {/* Logo/Brand area */}
        <div className="flex items-center gap-2 text-white/80">
          <Sparkles className="w-5 h-5" />
          <span className="text-lg font-medium tracking-tight">Expound</span>
        </div>

        {isUploading && uploadsWithThumbnails.length > 0 ? (
          // Upload progress with thumbnails
          <div className="flex flex-col items-center gap-6 w-full">
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold text-white">
                Uploading {uploadsWithThumbnails.length} video{uploadsWithThumbnails.length > 1 ? "s" : ""}
              </h1>
              <p className="text-zinc-400">
                Your videos will be transcribed automatically
              </p>
            </div>

            {/* Video thumbnails grid with progress */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 w-full max-w-xl">
              {uploadsWithThumbnails.map((upload) => (
                <div
                  key={upload.id}
                  className="relative aspect-video rounded-lg overflow-hidden bg-zinc-800 border border-zinc-700"
                >
                  {/* Thumbnail */}
                  {upload.thumbnail ? (
                    <img
                      src={upload.thumbnail}
                      alt={upload.file.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Video className="w-6 h-6 text-zinc-600" />
                    </div>
                  )}

                  {/* Progress overlay */}
                  {upload.status !== "uploaded" && (
                    <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2">
                      <span className="text-white text-sm font-medium">
                        {upload.progress}%
                      </span>
                      {/* Progress bar */}
                      <div className="w-3/4 h-1 bg-zinc-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all duration-300"
                          style={{ width: `${upload.progress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Completed checkmark */}
                  {upload.status === "uploaded" && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                      <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center">
                        <Check className="w-5 h-5 text-white" />
                      </div>
                    </div>
                  )}

                  {/* File name */}
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                    <p className="text-xs text-white truncate">
                      {upload.file.name}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* Overall progress */}
            <div className="text-sm text-zinc-500">
              {uploadsWithThumbnails.filter(u => u.status === "uploaded").length} of {uploadsWithThumbnails.length} uploaded
            </div>
          </div>
        ) : (
          // Upload state
          <>
            {/* Drop zone */}
            <div
              onClick={open}
              className={`
                relative w-full aspect-[4/3] md:aspect-[4/3] max-w-sm md:max-w-md rounded-2xl md:rounded-3xl cursor-pointer
                border-2 border-dashed transition-all duration-300
                flex flex-col items-center justify-center gap-4 md:gap-6 p-6 md:p-8
                ${isDragging
                  ? "border-primary bg-primary/10 scale-105"
                  : "border-zinc-700 hover:border-zinc-500 hover:bg-zinc-900/50 active:bg-zinc-900/70"
                }
              `}
            >
              {/* Icon */}
              <div className={`
                w-16 h-16 md:w-20 md:h-20 rounded-xl md:rounded-2xl flex items-center justify-center transition-all duration-300
                ${isDragging
                  ? "bg-primary scale-110"
                  : "bg-gradient-to-br from-zinc-800 to-zinc-900"
                }
              `}>
                {isDragging ? (
                  <Video className="w-8 h-8 md:w-10 md:h-10 text-white" />
                ) : (
                  <Upload className="w-8 h-8 md:w-10 md:h-10 text-zinc-400" />
                )}
              </div>

              {/* Text */}
              <div className="space-y-1 md:space-y-2">
                <h1 className="text-lg md:text-xl font-semibold text-white">
                  {isDragging ? "Drop your videos" : "Tap to upload videos"}
                </h1>
                <p className="text-sm text-zinc-500">
                  or drag and drop
                </p>
              </div>
            </div>

            {/* Feature pills */}
            <div className="flex flex-wrap items-center justify-center gap-1.5 md:gap-2 px-2">
              {[
                "Auto-removes filler words",
                "Removes stammering",
                "Smart ordering",
                "Instant transcription",
              ].map((feature) => (
                <span
                  key={feature}
                  className="px-2.5 md:px-3 py-1 md:py-1.5 rounded-full text-[11px] md:text-xs font-medium bg-zinc-800/50 text-zinc-400 border border-zinc-700/50"
                >
                  {feature}
                </span>
              ))}
            </div>

            {/* Hint */}
            <p className="text-xs text-zinc-600">
              MP4, MOV, WebM supported
            </p>
          </>
        )}
      </div>

      {/* Decorative gradient orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-primary/3 rounded-full blur-3xl pointer-events-none" />
    </div>
  );
};

export default UploadLanding;
