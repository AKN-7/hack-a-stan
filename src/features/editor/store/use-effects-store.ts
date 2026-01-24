import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface SegmentZoomSettings {
  enabled: boolean;
  amount: number; // 1.05 = 5% zoom, 1.1 = 10% zoom
  pattern: "alternate" | "all-zoomed" | "first-normal";
}

export interface TransitionSettings {
  enabled: boolean;
  type: "fade" | "crossfade" | "slide" | "none";
  durationMs: number; // Duration of transition in milliseconds
}

interface IEffectsStore {
  // Segment zoom settings (for jump-cut smoothing)
  segmentZoom: SegmentZoomSettings;

  // Transition settings between segments
  transitions: TransitionSettings;

  // Actions
  setSegmentZoom: (settings: Partial<SegmentZoomSettings>) => void;
  setTransitions: (settings: Partial<TransitionSettings>) => void;
  enableSmoothCuts: (zoomAmount?: number) => void;
  disableSmoothCuts: () => void;
  reset: () => void;
}

const DEFAULT_ZOOM: SegmentZoomSettings = {
  enabled: false,
  amount: 1.05, // 5% zoom - subtle but effective
  pattern: "alternate",
};

const DEFAULT_TRANSITIONS: TransitionSettings = {
  enabled: false,
  type: "fade",
  durationMs: 200,
};

const useEffectsStore = create<IEffectsStore>()(
  persist(
    (set) => ({
      segmentZoom: DEFAULT_ZOOM,
      transitions: DEFAULT_TRANSITIONS,

      setSegmentZoom: (settings) =>
        set((state) => ({
          segmentZoom: { ...state.segmentZoom, ...settings },
        })),

      setTransitions: (settings) =>
        set((state) => ({
          transitions: { ...state.transitions, ...settings },
        })),

      enableSmoothCuts: (zoomAmount = 1.05) =>
        set((state) => ({
          segmentZoom: {
            ...state.segmentZoom,
            enabled: true,
            amount: zoomAmount,
          },
        })),

      disableSmoothCuts: () =>
        set((state) => ({
          segmentZoom: {
            ...state.segmentZoom,
            enabled: false,
          },
        })),

      reset: () =>
        set({
          segmentZoom: DEFAULT_ZOOM,
          transitions: DEFAULT_TRANSITIONS,
        }),
    }),
    {
      name: "effects-store",
      partialize: (state) => ({
        segmentZoom: state.segmentZoom,
        transitions: state.transitions,
      }),
    }
  )
);

export default useEffectsStore;
