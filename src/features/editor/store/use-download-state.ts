import { IDesign } from "@designcombo/types";
import { create } from "zustand";
import useTranscriptStore from "./use-transcript-store";

interface Output {
  url: string;
  type: string;
}

interface DownloadState {
  projectId: string;
  exporting: boolean;
  exportType: "json" | "mp4";
  progress: number;
  output?: Output;
  payload?: IDesign;
  displayProgressModal: boolean;
  error?: string;
  actions: {
    setProjectId: (projectId: string) => void;
    setExporting: (exporting: boolean) => void;
    setExportType: (exportType: "json" | "mp4") => void;
    setProgress: (progress: number) => void;
    setState: (state: Partial<DownloadState>) => void;
    setOutput: (output: Output) => void;
    startExport: () => void;
    setDisplayProgressModal: (displayProgressModal: boolean) => void;
  };
}

//const baseUrl = "https://api.combo.sh/v1";

export const useDownloadState = create<DownloadState>((set, get) => ({
  projectId: "",
  exporting: false,
  exportType: "mp4",
  progress: 0,
  displayProgressModal: false,
  actions: {
    setProjectId: (projectId) => set({ projectId }),
    setExporting: (exporting) => set({ exporting }),
    setExportType: (exportType) => set({ exportType }),
    setProgress: (progress) => set({ progress }),
    setState: (state) => set({ ...state }),
    setOutput: (output) => set({ output }),
    setDisplayProgressModal: (displayProgressModal) =>
      set({ displayProgressModal }),
    startExport: async () => {
      try {
        // Set exporting to true at the start
        set({ exporting: true, displayProgressModal: true, error: undefined, progress: 0 });

        // Assume payload to be stored in the state for POST request
        const { payload } = get();

        if (!payload) throw new Error("Payload is not defined");

        // Get transcript render segments for transcript-driven export
        const transcriptStore = useTranscriptStore.getState();
        const renderSegments = transcriptStore.getRenderSegments();
        const totalDurationMs = transcriptStore.getTotalDurationMs();
        const captions = transcriptStore.getCaptionsForRender();

        // Step 1: POST request to start rendering
        const response = await fetch(`/api/render`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            design: payload,
            options: {
              fps: 30,
              size: payload.size,
              format: "mp4"
            },
            // Include transcript segments for transcript-driven rendering
            transcriptSegments: renderSegments.length > 0 ? renderSegments : undefined,
            transcriptDurationMs: renderSegments.length > 0 ? totalDurationMs : undefined,
            // Include captions mapped to output timeline
            captions: captions.length > 0 ? captions : undefined,
          })
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || "Failed to submit export request.");
        }

        const jobInfo = await response.json();
        const jobId = jobInfo.render.id;
        const bucketName = jobInfo.render.bucketName;

        // Step 2 & 3: Polling for status updates
        const checkStatus = async () => {
          try {
            const statusResponse = await fetch(
              `/api/render/${jobId}?bucketName=${encodeURIComponent(bucketName)}`,
              {
                headers: {
                  "Content-Type": "application/json"
                }
              }
            );

            if (!statusResponse.ok) {
              const errorData = await statusResponse.json();
              throw new Error(errorData.message || "Failed to fetch export status.");
            }

            const statusInfo = await statusResponse.json();
            const { status, progress, presigned_url: url, errors, fatalErrorEncountered } = statusInfo.render;

            console.log("[Export Status]", { status, progress, fatalErrorEncountered, errors });

            set({ progress });

            if (status === "COMPLETED") {
              set({ exporting: false, output: { url, type: get().exportType } });
            } else if (status === "FAILED" || fatalErrorEncountered) {
              const errorMsg = errors?.length > 0
                ? (typeof errors[0] === 'string' ? errors[0] : errors[0]?.message || JSON.stringify(errors[0]))
                : "Render failed - check Lambda logs";
              console.error("[Export Failed]", errors);
              set({ exporting: false, error: errorMsg });
            } else if (status === "PROCESSING" || status === "PENDING") {
              setTimeout(checkStatus, 5000); // 5s to avoid Lambda rate limits
            }
          } catch (error) {
            console.error("Status check error:", error);
            set({ exporting: false, error: String(error) });
          }
        };

        checkStatus();
      } catch (error) {
        console.error("Export error:", error);
        set({ exporting: false, error: String(error) });
      }
    }
  }
}));
