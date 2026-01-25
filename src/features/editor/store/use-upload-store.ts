import { create } from "zustand";
import { persist } from "zustand/middleware";
import { processUpload, type UploadCallbacks } from "@/utils/upload-service";
import useTranscriptStore from "./use-transcript-store";

interface UploadFile {
  id: string;
  file?: File;
  url?: string;
  type?: string;
  status?: "pending" | "uploading" | "uploaded" | "failed";
  progress?: number;
  error?: string;
}

interface IUploadStore {
  showUploadModal: boolean;
  setShowUploadModal: (showUploadModal: boolean) => void;
  uploadProgress: Record<string, number>;
  setUploadProgress: (uploadProgress: Record<string, number>) => void;
  uploadsVideos: any[];
  setUploadsVideos: (uploadsVideos: any[]) => void;
  uploadsAudios: any[];
  setUploadsAudios: (uploadsAudios: any[]) => void;
  uploadsImages: any[];
  setUploadsImages: (uploadsImages: any[]) => void;
  files: UploadFile[];
  setFiles: (
    files: UploadFile[] | ((prev: UploadFile[]) => UploadFile[])
  ) => void;

  pendingUploads: UploadFile[];
  addPendingUploads: (uploads: UploadFile[]) => void;
  clearPendingUploads: () => void;
  activeUploads: UploadFile[];
  processUploads: () => void;
  updateUploadProgress: (id: string, progress: number) => void;
  setUploadStatus: (
    id: string,
    status: UploadFile["status"],
    error?: string
  ) => void;
  removeUpload: (id: string) => void;
  deleteUpload: (id: string) => void; // Delete from completed uploads
  uploads: any[];
  setUploads: (uploads: any[] | ((prev: any[]) => any[])) => void;
}

const useUploadStore = create<IUploadStore>()(
  persist(
    (set, get) => ({
      showUploadModal: false,
      setShowUploadModal: (showUploadModal: boolean) =>
        set({ showUploadModal }),

      uploadProgress: {},
      setUploadProgress: (uploadProgress: Record<string, number>) =>
        set({ uploadProgress }),

      uploadsVideos: [],
      setUploadsVideos: (uploadsVideos: any[]) => set({ uploadsVideos }),

      uploadsAudios: [],
      setUploadsAudios: (uploadsAudios: any[]) => set({ uploadsAudios }),

      uploadsImages: [],
      setUploadsImages: (uploadsImages: any[]) => set({ uploadsImages }),

      files: [],
      setFiles: (
        files: UploadFile[] | ((prev: UploadFile[]) => UploadFile[])
      ) =>
        set((state) => ({
          files:
            typeof files === "function"
              ? (files as (prev: UploadFile[]) => UploadFile[])(state.files)
              : files
        })),

      pendingUploads: [],
      addPendingUploads: (uploads: UploadFile[]) => {
        set((state) => ({
          pendingUploads: [...state.pendingUploads, ...uploads]
        }));
      },
      clearPendingUploads: () => set({ pendingUploads: [] }),

      activeUploads: [],
      processUploads: () => {
        const {
          pendingUploads,
          activeUploads,
          updateUploadProgress,
          setUploadStatus,
          removeUpload,
          setUploads
        } = get();

        // Move pending uploads to active with 'uploading' status
        if (pendingUploads.length > 0) {
          set((state) => ({
            activeUploads: [
              ...state.activeUploads,
              ...pendingUploads.map((u) => ({
                ...u,
                status: "uploading" as const,
                progress: 0
              }))
            ],
            pendingUploads: []
          }));
        }

        // Get updated activeUploads after moving pending ones
        const currentActiveUploads = get().activeUploads;

        const callbacks: UploadCallbacks = {
          onProgress: (uploadId, progress) => {
            updateUploadProgress(uploadId, progress);
          },
          onStatus: (uploadId, status, error) => {
            setUploadStatus(uploadId, status, error);
            if (status === "uploaded") {
              // Remove immediately - transcribing status will take over for videos
              removeUpload(uploadId);
            } else if (status === "failed") {
              // Keep failed uploads visible briefly so user sees the error
              setTimeout(() => removeUpload(uploadId), 3000);
            }
          }
        };

        // Process all uploading items
        for (const upload of currentActiveUploads.filter(
          (upload) => upload.status === "uploading"
        )) {
          console.log("upload", upload);
          processUpload(
            upload.id,
            { file: upload.file, url: upload.url },
            callbacks
          )
            .then((uploadData) => {
              // Add the complete upload data to the uploads array
              if (uploadData) {
                if (Array.isArray(uploadData)) {
                  // URL uploads return an array
                  setUploads((prev) => [...prev, ...uploadData]);
                  // Auto-transcribe videos and audio files
                  for (const data of uploadData) {
                    const mediaUrl = data.metadata?.uploadedUrl || data.url;
                    const clipId = data.filePath || upload.id;

                    if (data.contentType?.startsWith("video/") && mediaUrl) {
                      // Video file - add as video_with_audio (will be changed to video_only if empty transcription)
                      useTranscriptStore.getState().addClip(clipId, mediaUrl, "video_with_audio");
                      useTranscriptStore.getState().transcribeClip(clipId);
                    } else if (data.contentType?.startsWith("audio/") && mediaUrl) {
                      // Audio file - add as audio_only and transcribe
                      useTranscriptStore.getState().addClip(clipId, mediaUrl, "audio_only");
                      useTranscriptStore.getState().transcribeClip(clipId);
                    }
                  }
                } else {
                  // File uploads return a single object
                  setUploads((prev) => [...prev, uploadData]);
                  // Auto-transcribe video and audio files
                  const mediaUrl = uploadData.metadata?.uploadedUrl || uploadData.url;
                  const clipId = uploadData.filePath || upload.id;

                  if (uploadData.contentType?.startsWith("video/") && mediaUrl) {
                    // Video file - add as video_with_audio (will be changed to video_only if empty transcription)
                    useTranscriptStore.getState().addClip(clipId, mediaUrl, "video_with_audio");
                    useTranscriptStore.getState().transcribeClip(clipId);
                  } else if (uploadData.contentType?.startsWith("audio/") && mediaUrl) {
                    // Audio file - add as audio_only and transcribe
                    useTranscriptStore.getState().addClip(clipId, mediaUrl, "audio_only");
                    useTranscriptStore.getState().transcribeClip(clipId);
                  }
                }
              }
            })
            .catch((error) => {
              console.error("Upload failed:", error);
            });
        }
      },
      updateUploadProgress: (id: string, progress: number) =>
        set((state) => ({
          activeUploads: state.activeUploads.map((u) =>
            u.id === id ? { ...u, progress } : u
          )
        })),
      setUploadStatus: (
        id: string,
        status: UploadFile["status"],
        error?: string
      ) =>
        set((state) => ({
          activeUploads: state.activeUploads.map((u) =>
            u.id === id ? { ...u, status, error } : u
          )
        })),
      removeUpload: (id: string) =>
        set((state) => ({
          activeUploads: state.activeUploads.filter((u) => u.id !== id)
        })),
      deleteUpload: (id: string) => {
        set((state) => {
          // Find the upload to get its clip ID
          const upload = state.uploads.find((u) => u.id === id || u.filePath === id);

          // Remove from transcript store if it's a video
          if (upload) {
            const clipId = upload.filePath || upload.id;
            useTranscriptStore.getState().removeClip(clipId);
          }

          return {
            uploads: state.uploads.filter((u) => u.id !== id && u.filePath !== id)
          };
        });
      },
      uploads: [],
      setUploads: (uploads: any[] | ((prev: any[]) => any[])) =>
        set((state) => ({
          uploads:
            typeof uploads === "function"
              ? (uploads as (prev: any[]) => any[])(state.uploads)
              : uploads
        }))
    }),
    {
      name: "upload-store",
      partialize: (state) => ({ uploads: state.uploads })
    }
  )
);

export type { UploadFile };
export default useUploadStore;
