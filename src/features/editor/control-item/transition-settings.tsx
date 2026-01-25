"use client";

import { useState, useMemo } from "react";
import { ChevronLeft, Clock, Trash2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import useTranscriptStore, { TransitionType, TransitionDirection, ClipTransition } from "../store/use-transcript-store";
import useStore from "../store/use-store";
import { TRANSITIONS } from "../data/transitions";

interface TransitionSettingsProps {
  transitionId: string; // Format: "transition-{fromClipId}-{toClipId}"
  onBack: () => void;
}

export function TransitionSettings({ transitionId, onBack }: TransitionSettingsProps) {
  // Parse clip IDs from transition ID - format is "transition::{fromClipId}::{toClipId}"
  const parts = transitionId.split("::");
  const parsedFromClipId = parts[1] || "";
  const parsedToClipId = parts[2] || "";

  const {
    clips,
    clipOrder,
    getTransitionBetween,
    setTransition,
    updateTransition,
    removeTransition,
    clipTransitions
  } = useTranscriptStore();
  const { clearTimelineSelection } = useStore();

  // Get current transition (may not exist yet)
  const currentTransition = useMemo(() => {
    // Find transition in clipTransitions using parsed clip IDs
    return Object.values(clipTransitions).find(
      t => t.fromClipId === parsedFromClipId && t.toClipId === parsedToClipId
    ) || null;
  }, [clipTransitions, parsedFromClipId, parsedToClipId]);

  // Get clip indices for display
  const fromClipIndex = clipOrder.findIndex(id => id === parsedFromClipId);
  const toClipIndex = clipOrder.findIndex(id => id === parsedToClipId);

  // Local state for editing
  const [selectedType, setSelectedType] = useState<TransitionType>(
    currentTransition?.type || "none"
  );
  const [selectedDirection, setSelectedDirection] = useState<TransitionDirection | undefined>(
    currentTransition?.direction
  );
  const [durationMs, setDurationMs] = useState(
    currentTransition?.durationMs || 500
  );

  // Group transitions by kind for UI
  const transitionGroups = useMemo(() => {
    const groups: Record<string, typeof TRANSITIONS> = {};
    for (const t of TRANSITIONS) {
      if (!groups[t.kind]) groups[t.kind] = [];
      groups[t.kind].push(t);
    }
    return groups;
  }, []);

  // Handle transition type selection
  const handleSelectTransition = (kind: TransitionType, direction?: TransitionDirection) => {
    setSelectedType(kind);
    setSelectedDirection(direction as TransitionDirection | undefined);

    // Find the clip IDs from the current transition or parse from ID
    const fromId = currentTransition?.fromClipId || parsedFromClipId;
    const toId = currentTransition?.toClipId || parsedToClipId;

    console.log("[Transition] Setting transition:", { fromId, toId, kind, durationMs, direction });

    if (fromId && toId) {
      setTransition(fromId, toId, kind, durationMs, direction as TransitionDirection | undefined);
    } else {
      console.warn("[Transition] Missing clip IDs:", { fromId, toId, transitionId, parsedFromClipId, parsedToClipId });
    }
  };

  // Handle duration change
  const handleDurationChange = (value: number[]) => {
    const newDuration = value[0];
    setDurationMs(newDuration);

    if (currentTransition) {
      updateTransition(currentTransition.id, { durationMs: newDuration });
    } else {
      // Create transition if it doesn't exist
      const fromId = parsedFromClipId;
      const toId = parsedToClipId;
      if (fromId && toId && selectedType !== "none") {
        setTransition(fromId, toId, selectedType, newDuration, selectedDirection);
      }
    }
  };

  // Handle remove transition
  const handleRemove = () => {
    if (currentTransition) {
      removeTransition(currentTransition.id);
    }
    setSelectedType("none");
    setSelectedDirection(undefined);
  };

  // Handle back - clear selection
  const handleBack = () => {
    clearTimelineSelection();
    onBack();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={handleBack}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h3 className="font-semibold text-sm">Transition</h3>
          <p className="text-xs text-muted-foreground">
            Clip {fromClipIndex + 1} → Clip {toClipIndex + 1}
          </p>
        </div>
        {currentTransition && currentTransition.type !== "none" && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={handleRemove}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Transition Type Grid */}
        <div className="space-y-3">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Effect
          </Label>
          <div className="grid grid-cols-3 gap-2">
            {TRANSITIONS.map((t) => {
              const isSelected =
                selectedType === t.kind &&
                (!t.direction || selectedDirection === t.direction);

              return (
                <button
                  key={t.id}
                  onClick={() => handleSelectTransition(t.kind as TransitionType, t.direction as TransitionDirection)}
                  className={cn(
                    "relative aspect-video rounded-lg overflow-hidden border-2 transition-all",
                    "hover:scale-105 hover:shadow-md",
                    isSelected
                      ? "border-primary ring-2 ring-primary/20"
                      : "border-transparent hover:border-muted-foreground/30"
                  )}
                >
                  <img
                    src={t.preview}
                    alt={t.name || t.kind}
                    className="w-full h-full object-cover"
                  />
                  {isSelected && (
                    <div className="absolute inset-0 bg-primary/10 flex items-center justify-center">
                      <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                        <Sparkles className="w-3 h-3 text-white" />
                      </div>
                    </div>
                  )}
                  <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent p-1.5">
                    <span className="text-[10px] text-white font-medium capitalize">
                      {t.name || t.kind}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Duration Slider */}
        {selectedType !== "none" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Duration
              </Label>
              <span className="text-sm font-medium tabular-nums">
                {(durationMs / 1000).toFixed(1)}s
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <Slider
                value={[durationMs]}
                onValueChange={handleDurationChange}
                min={100}
                max={2000}
                step={100}
                className="flex-1"
              />
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>0.1s</span>
              <span>2.0s</span>
            </div>
          </div>
        )}

        {/* Preview hint */}
        {selectedType !== "none" && (
          <div className="rounded-lg bg-muted/50 p-3 text-center">
            <p className="text-xs text-muted-foreground">
              Preview the transition by playing the video
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default TransitionSettings;
