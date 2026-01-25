"use client";

import { useState, useCallback, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, Video, Music, Check, X, Plus } from "lucide-react";
import useUploadStore from "./store/use-upload-store";
import { ThreeDMarquee } from "@/components/ui/3d-marquee";
import { Button } from "@/components/ui/button";

interface UploadWithThumbnail {
  id: string;
  file: File;
  thumbnail: string | null;
  progress: number;
  status: "staged" | "pending" | "uploading" | "uploaded" | "failed";
}

const UploadLanding = () => {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadsWithThumbnails, setUploadsWithThumbnails] = useState<UploadWithThumbnail[]>([]);
  const [isStaging, setIsStaging] = useState(false); // Files selected but not yet uploading
  const { addPendingUploads, processUploads, activeUploads, pendingUploads } = useUploadStore();

  const isUploading = activeUploads.length > 0 || pendingUploads.length > 0;
  const hasFiles = uploadsWithThumbnails.length > 0;

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
        // Use 9:16 vertical aspect ratio to match final output
        canvas.width = 90;
        canvas.height = 160;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          // Center-crop the video frame to fit 9:16
          const videoAspect = video.videoWidth / video.videoHeight;
          const canvasAspect = canvas.width / canvas.height;

          let sx = 0, sy = 0, sw = video.videoWidth, sh = video.videoHeight;

          if (videoAspect > canvasAspect) {
            // Video is wider - crop sides
            sw = video.videoHeight * canvasAspect;
            sx = (video.videoWidth - sw) / 2;
          } else {
            // Video is taller - crop top/bottom
            sh = video.videoWidth / canvasAspect;
            sy = (video.videoHeight - sh) / 2;
          }

          ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
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

    // Filter for video and audio files
    const mediaFiles = acceptedFiles.filter(f =>
      f.type.startsWith("video/") || f.type.startsWith("audio/")
    );

    if (mediaFiles.length === 0) {
      return;
    }

    // Create upload entries with IDs - staged, not uploading yet
    const uploadEntries: UploadWithThumbnail[] = mediaFiles.map(file => ({
      id: crypto.randomUUID(),
      file,
      thumbnail: null,
      progress: 0,
      status: "staged" as const,
    }));

    // Add to existing staged files (allow adding more)
    setUploadsWithThumbnails(prev => [...prev, ...uploadEntries]);
    setIsStaging(true);

    // Generate thumbnails in parallel (only for video files)
    const thumbnailPromises = uploadEntries.map(async (entry) => {
      if (entry.file.type.startsWith("video/")) {
        const thumbnail = await generateThumbnail(entry.file);
        return { id: entry.id, thumbnail };
      }
      return { id: entry.id, thumbnail: null };
    });

    // Update thumbnails as they complete
    thumbnailPromises.forEach(async (promise) => {
      const { id, thumbnail } = await promise;
      setUploadsWithThumbnails(prev =>
        prev.map(u => u.id === id ? { ...u, thumbnail } : u)
      );
    });
  }, []);

  // Remove a staged file
  const removeFile = useCallback((id: string) => {
    setUploadsWithThumbnails(prev => {
      const updated = prev.filter(u => u.id !== id);
      if (updated.length === 0) {
        setIsStaging(false);
      }
      return updated;
    });
  }, []);

  // Start uploading all staged files
  const startUpload = useCallback(() => {
    if (uploadsWithThumbnails.length === 0) return;

    // Mark all as pending
    setUploadsWithThumbnails(prev =>
      prev.map(u => ({ ...u, status: "pending" as const }))
    );
    setIsStaging(false);

    // Add to upload store and process
    const uploads = uploadsWithThumbnails.map(entry => ({
      id: entry.id,
      file: entry.file,
      type: entry.file.type,
      status: "pending" as const,
    }));

    addPendingUploads(uploads);
    processUploads();
  }, [uploadsWithThumbnails, addPendingUploads, processUploads]);

  const { getRootProps, getInputProps, open } = useDropzone({
    onDrop,
    accept: {
      "video/*": [".mp4", ".mov", ".webm", ".mkv", ".avi"],
      "audio/*": [".mp3", ".m4a", ".wav", ".aac"],
    },
    noClick: true,
    onDragEnter: () => setIsDragging(true),
    onDragLeave: () => setIsDragging(false),
  });

  // Sample images for the 3D marquee - using placeholder video thumbnails
  const marqueeImages = [
    "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=300&fit=crop",
    "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=400&h=300&fit=crop",
    "https://images.unsplash.com/photo-1507591064344-4c6ce005b128?w=400&h=300&fit=crop",
    "https://images.unsplash.com/photo-1494790108755-2616b612b890?w=400&h=300&fit=crop",
    "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&h=300&fit=crop",
    "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400&h=300&fit=crop",
    "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400&h=300&fit=crop",
    "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&h=300&fit=crop",
    "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400&h=300&fit=crop",
    "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400&h=300&fit=crop",
    "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=400&h=300&fit=crop",
    "https://images.unsplash.com/photo-1489424731084-a5d8b219a5bb?w=400&h=300&fit=crop",
    "https://images.unsplash.com/photo-1504593811423-6dd665756598?w=400&h=300&fit=crop",
    "https://images.unsplash.com/photo-1502823403499-6ccfcf4fb453?w=400&h=300&fit=crop",
    "https://images.unsplash.com/photo-1521119989659-a83eee488004?w=400&h=300&fit=crop",
    "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=400&h=300&fit=crop",
  ];

  return (
    <div
      {...getRootProps()}
      className={`
        fixed inset-0 z-50 flex items-center justify-center
        bg-white
        transition-all duration-300 safe-area-inset
        ${isDragging ? "bg-primary/10" : ""}
      `}
    >
      <input {...getInputProps()} />

      {/* 3D Marquee Background */}
      {!isUploading && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <ThreeDMarquee
            images={marqueeImages}
            className="h-full w-full opacity-20"
          />
        </div>
      )}

      {/* Main content */}
      <div className="relative z-10 flex flex-col items-center justify-center gap-6 md:gap-8 p-4 md:p-8 max-w-2xl text-center w-full">
        {/* Logo/Brand area */}
        <div className="flex items-center gap-2">
          <span className="text-5xl md:text-7xl font-bold tracking-tight text-primary" style={{ fontFamily: 'var(--font-sora), sans-serif' }}>
            Distill
          </span>
        </div>

        {hasFiles ? (
          // Staging or Upload progress with thumbnails
          <div className="flex flex-col items-center gap-6 w-full">
            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-primary">
                {isStaging
                  ? `${uploadsWithThumbnails.length} file${uploadsWithThumbnails.length > 1 ? "s" : ""} selected`
                  : `Uploading ${uploadsWithThumbnails.length} file${uploadsWithThumbnails.length > 1 ? "s" : ""}`
                }
              </h1>
              <p className="font-semibold text-foreground">
                {isStaging
                  ? "Review your clips, then hit Go"
                  : "Your media will be transcribed automatically"
                }
              </p>
            </div>

            {/* Video thumbnails grid - scrollable container */}
            <div className="w-full max-w-xl max-h-[50vh] overflow-y-auto rounded-xl">
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2 p-1">
              {uploadsWithThumbnails.map((upload) => (
                <div
                  key={upload.id}
                  className="relative aspect-[9/16] rounded-lg overflow-hidden bg-white border-2 border-border group"
                >
                  {/* Thumbnail */}
                  {upload.thumbnail ? (
                    <img
                      src={upload.thumbnail}
                      alt={upload.file.name}
                      className="w-full h-full object-cover opacity-100"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-muted opacity-100">
                      {upload.file.type.startsWith("audio/") ? (
                        <Music className="w-6 h-6 text-muted-foreground" />
                      ) : (
                        <Video className="w-6 h-6 text-muted-foreground" />
                      )}
                    </div>
                  )}

                  {/* Staged - show remove button on hover */}
                  {upload.status === "staged" && (
                    <button
                      onClick={() => removeFile(upload.id)}
                      className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500"
                    >
                      <X className="w-4 h-4 text-white" />
                    </button>
                  )}

                  {/* Progress overlay - only when actually uploading */}
                  {(upload.status === "pending" || upload.status === "uploading") && (
                    <div className="absolute inset-0 bg-white/60 flex flex-col items-center justify-center gap-2">
                      <span className="text-primary text-sm font-bold">
                        {upload.progress}%
                      </span>
                      <div className="w-3/4 h-2 bg-border rounded-full overflow-hidden border border-border">
                        <div
                          className="h-full bg-primary rounded-full transition-all duration-300"
                          style={{ width: `${upload.progress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Completed checkmark */}
                  {upload.status === "uploaded" && (
                    <div className="absolute inset-0 bg-white/90 flex items-center justify-center">
                      <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center border-2 border-green-600">
                        <Check className="w-6 h-6 text-white" />
                      </div>
                    </div>
                  )}

                  {/* File name */}
                  <div className="absolute bottom-0 left-0 right-0 bg-white p-2 border-t-2 border-border">
                    <p className="text-xs text-foreground truncate font-bold">
                      {upload.file.name}
                    </p>
                  </div>
                </div>
              ))}

              {/* Add more button when staging */}
              {isStaging && (
                <button
                  onClick={open}
                  className="aspect-[9/16] rounded-lg border-2 border-dashed border-primary/30 hover:border-primary hover:bg-primary/5 flex flex-col items-center justify-center gap-2 transition-colors"
                >
                  <Plus className="w-6 h-6 text-primary/50" />
                  <span className="text-xs text-primary/50 font-medium">Add more</span>
                </button>
              )}
              </div>
            </div>

            {/* Action buttons */}
            {isStaging ? (
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setUploadsWithThumbnails([]);
                    setIsStaging(false);
                  }}
                  className="px-6"
                >
                  Cancel
                </Button>
                <Button
                  onClick={startUpload}
                  className="px-8 text-lg font-bold"
                  size="lg"
                >
                  Go
                </Button>
              </div>
            ) : (
              <div className="text-sm font-semibold text-foreground">
                {uploadsWithThumbnails.filter(u => u.status === "uploaded").length} of {uploadsWithThumbnails.length} uploaded
              </div>
            )}
          </div>
        ) : (
          // Upload state
          <>
            {/* Drop zone */}
            <div
              onClick={open}
              className={`
                group relative w-full aspect-[4/3] md:aspect-[4/3] max-w-sm md:max-w-md rounded-2xl md:rounded-3xl cursor-pointer
                border-4 border-dashed transition-all duration-300 bg-white
                flex flex-col items-center justify-center gap-4 md:gap-6 p-6 md:p-8
                ${isDragging
                  ? "border-primary bg-primary/20 scale-105"
                  : "border-primary/30 hover:border-primary hover:bg-primary/10 active:bg-primary/15"
                }
              `}
            >
              {/* Icon */}
              <div className={`
                w-16 h-16 md:w-20 md:h-20 rounded-xl md:rounded-2xl flex items-center justify-center transition-all duration-300 border-2
                ${isDragging
                  ? "bg-primary border-primary scale-110"
                  : "bg-white border-primary/40 group-hover:bg-primary group-hover:border-primary"
                }
              `}>
                {isDragging ? (
                  <Video className="w-8 h-8 md:w-10 md:h-10 text-white" />
                ) : (
                  <Upload className="w-8 h-8 md:w-10 md:h-10 text-primary group-hover:text-white transition-colors" />
                )}
              </div>

              {/* Text */}
              <div className="space-y-1 md:space-y-2">
                <h1 className="text-lg md:text-xl font-bold text-foreground">
                  {isDragging ? "Drop your files" : "Tap to upload media"}
                </h1>
                <p className="text-sm font-semibold text-primary">
                  or drag and drop
                </p>
              </div>
              
              {/* File format hint at bottom */}
              <p className="absolute bottom-6 md:bottom-8 text-[10px] md:text-xs text-muted-foreground font-medium">
                MP4, MOV, WebM, M4A, MP3 supported
              </p>
            </div>

            {/* Feature pills */}
            <div className="flex flex-wrap items-center justify-center gap-2 md:gap-3 px-2">
              {[
                "Auto-removes filler words",
                "Removes stammering",
                "Smart ordering",
                "Instant transcription",
              ].map((feature) => (
                <span
                  key={feature}
                  className="px-3 md:px-4 py-1.5 md:py-2 rounded-full text-xs md:text-sm font-semibold bg-card text-foreground border-2 border-border shadow-sm"
                >
                  {feature}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

    </div>
  );
};

export default UploadLanding;
