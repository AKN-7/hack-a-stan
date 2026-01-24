import React, { use, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "./ui/dialog";
import { FileIcon, GripVertical, UploadIcon, X } from "lucide-react";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import { motion, AnimatePresence, Reorder } from "framer-motion";
import clsx from "clsx";
import useUploadStore from "@/features/editor/store/use-upload-store";
import axios from "axios";
import { Input } from "./ui/input";
type ModalUploadProps = {
  type?: string;
};

export const extractVideoThumbnail = (file: File) => {
  return new Promise<string>((resolve) => {
    const video = document.createElement("video");
    video.src = URL.createObjectURL(file);
    video.currentTime = 1;
    video.muted = true;
    video.playsInline = true;
    video.onloadeddata = () => {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/png"));
    };
    video.onerror = () => resolve("");
  });
};
const ModalUpload: React.FC<ModalUploadProps> = ({ type = "all" }) => {
  const {
    setShowUploadModal,
    showUploadModal,
    setFiles,
    files,
    addPendingUploads,
    processUploads
  } = useUploadStore();
  const [videoThumbnails, setVideoThumbnails] = useState<{
    [name: string]: string;
  }>({});
  const [videoUrl, setVideoUrl] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;

    const selectedFiles = Array.from(e.target.files);

    const newFiles = selectedFiles
      .filter((f) => !files.some((fileObj) => fileObj.file?.name === f.name))
      .map((f) => ({ id: crypto.randomUUID(), file: f }));

    if (newFiles.length === 0) return;

    setFiles((prev) => [...newFiles, ...prev]);

    const videoThumbnailsData = await Promise.all(
      newFiles
        .filter((f) => f.file?.type.startsWith("video/"))
        .map(async (f) => ({
          name: f.file?.name ?? "",
          thumb: f.file ? await extractVideoThumbnail(f.file) : ""
        }))
    );
    setVideoThumbnails((prev) => ({
      ...prev,
      ...Object.fromEntries(videoThumbnailsData.map((v) => [v.name, v.thumb]))
    }));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    if (e.dataTransfer.files) {
      const newFiles = Array.from(e.dataTransfer.files)
        .filter((f) => !files.some((fileObj) => fileObj.file?.name === f.name))
        .map((f) => ({ id: crypto.randomUUID(), file: f }));
      if (newFiles.length === 0) return;

      setFiles((prev) => [...newFiles, ...prev]);
      const videoThumbnailsData = await Promise.all(
        newFiles
          .filter((f) => f.file?.type.startsWith("video/"))
          .map(async (f) => ({
            name: f.file?.name ?? "",
            thumb: f.file ? await extractVideoThumbnail(f.file) : ""
          }))
      );
      setVideoThumbnails((prev) => ({
        ...prev,
        ...Object.fromEntries(videoThumbnailsData.map((v) => [v.name, v.thumb]))
      }));
    }
  };

  const handleRemoveFile = (id: string, file: File) => {
    setFiles(files.filter((f) => f.id !== id));
  };
  function getTypeFromContentType(contentType: string): string {
    if (contentType.startsWith("video/")) return "video";
    if (contentType.startsWith("image/")) return "image";
    if (contentType.startsWith("audio/")) return "audio";
    if (contentType === "application/pdf") return "document";
    return "other";
  }

  async function createUpload(uploadData: {
    fileName: string;
    filePath: string;
    fileSize: number;
    contentType: string;
    metadata?: any;
    folder?: string;
    type: string;
    method: string;
    origin: string;
    status: string;
    isPreview?: boolean;
  }) {
    const response = await fetch("/api/uploads", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(uploadData)
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Failed to create upload");
    }

    return result.upload;
  }
  const handleUpload = async () => {
    // Prepare UploadFile objects for files
    const fileUploads = files
      .filter((f) => f.file?.type)
      .map((f) => ({
        id: f.id,
        file: f.file,
        type: f.file?.type,
        status: "pending" as const,
        progress: 0
      }));

    // Prepare UploadFile object for URL if present
    const urlUploads = videoUrl.trim()
      ? [
          {
            id: crypto.randomUUID(),
            url: videoUrl.trim(),
            type: "url",
            status: "pending" as const,
            progress: 0
          }
        ]
      : [];

    // Add to pending uploads
    addPendingUploads([...fileUploads, ...urlUploads]);

    setTimeout(() => {
      processUploads();
      // Clear modal state and close
      setFiles([]);
      setShowUploadModal(false);
      setVideoUrl("");
    }, 0);
  };
  const getAcceptType = () => {
    switch (type) {
      case "audio":
        return "audio/*";
      case "image":
        return "image/*";
      case "video":
        return "video/*";
      default:
        return "audio/*,image/*,video/*";
    }
  };
  useEffect(() => {
    setFiles([]);
  }, [showUploadModal]);

  return (
    <div>
      <Dialog open={showUploadModal} onOpenChange={setShowUploadModal}>
        <DialogContent className="sm:max-w-md bg-white border border-border shadow-2xl rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">Upload media</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            <label className="flex flex-col gap-2">
              <input
                type="file"
                accept={getAcceptType()}
                onChange={handleFileChange}
                multiple
                ref={fileInputRef}
                style={{ display: "none" }}
              />

              <div
                className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors duration-150 ${
                  isDragOver
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50 hover:bg-muted/50"
                }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-muted flex items-center justify-center">
                  <UploadIcon className="h-7 w-7 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  Drag and drop files here, or
                </p>
                <Button onClick={triggerFileInput} variant="outline" size="sm" className="rounded-lg font-medium">
                  Browse files
                </Button>
              </div>
            </label>

            {files.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {files.length > 1 ? "Drag to reorder" : "Selected file"} ({files.length})
                </span>
                <ScrollArea className="max-h-48">
                  <Reorder.Group
                    axis="y"
                    values={files}
                    onReorder={setFiles}
                    className="flex flex-col gap-2"
                  >
                    <AnimatePresence initial={false}>
                      {files.map((file, index) => (
                        <Reorder.Item
                          key={file.id}
                          value={file}
                          className="relative flex flex-col items-center p-2.5 border border-border rounded-xl bg-muted/30 w-full cursor-grab active:cursor-grabbing"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.15 }}
                          whileDrag={{
                            scale: 1.02,
                            boxShadow: "0 8px 20px rgba(0,0,0,0.12)",
                            backgroundColor: "white"
                          }}
                        >
                          <div className="w-full flex justify-between items-center">
                            <div className="flex flex-1 gap-3 items-center">
                              {/* Drag handle */}
                              <div className="flex items-center gap-2">
                                <div className="flex flex-col items-center justify-center text-muted-foreground/50">
                                  <GripVertical className="h-4 w-4" />
                                </div>
                                <span className="text-xs font-semibold text-muted-foreground w-5">
                                  {index + 1}
                                </span>
                              </div>

                              <div className="w-10 h-10 flex items-center justify-center">
                                {file.file?.type.startsWith("image/") ? (
                                  <img
                                    src={URL.createObjectURL(file.file)}
                                    alt={file.file.name}
                                    className="h-10 w-10 object-cover rounded-lg border border-border"
                                  />
                                ) : file.file?.type.startsWith("video/") &&
                                  videoThumbnails[file.file.name] ? (
                                  <img
                                    src={videoThumbnails[file.file.name]}
                                    alt={`${file.file.name} thumbnail`}
                                    className="h-10 w-10 object-cover rounded-lg border border-border"
                                  />
                                ) : (
                                  <div className="h-10 w-10 flex items-center justify-center rounded-lg border border-border bg-white">
                                    <FileIcon className="h-5 w-5 text-muted-foreground" />
                                  </div>
                                )}
                              </div>

                              <div className="flex-1 min-w-0">
                                <div
                                  className="truncate text-sm font-medium text-foreground"
                                  title={file.file?.name ?? ""}
                                >
                                  {file.file?.name ?? ""}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {file.file
                                    ? `${(file.file.size / 1024 / 1024).toFixed(2)} MB`
                                    : ""}
                                </div>
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                file.file && handleRemoveFile(file.id, file.file);
                              }}
                              size="icon"
                              className="h-8 w-8 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-50"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        </Reorder.Item>
                      ))}
                    </AnimatePresence>
                  </Reorder.Group>
                </ScrollArea>
              </div>
            )}

            <Input
              type="text"
              placeholder="Or paste a video URL..."
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              className="h-11 rounded-xl border-border bg-muted/50 focus:bg-white"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowUploadModal(false)} className="rounded-lg">
              Cancel
            </Button>
            <Button
              onClick={handleUpload}
              disabled={(files.length === 0 && !videoUrl) || isUploading}
              className="rounded-lg bg-primary hover:bg-primary/90 font-semibold shadow-md shadow-primary/25"
            >
              Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ModalUpload;
