import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { Image, Type, Music, Shapes, Film } from "lucide-react";
import useStore from "../store/use-store";
import { useCurrentPlayerFrame } from "../hooks/use-current-frame";
import { cn } from "@/lib/utils";
import { ITrackItem } from "@designcombo/types";
import { dispatch } from "@designcombo/events";
import { EDIT_OBJECT } from "@designcombo/state";

// Track type configuration
const TRACK_CONFIG: Record<string, { icon: React.ElementType; label: string; color: string; bgColor: string; hoverBg: string }> = {
  image: { icon: Image, label: "B-Roll", color: "text-emerald-600", bgColor: "bg-emerald-500", hoverBg: "hover:bg-emerald-400" },
  "video-broll": { icon: Film, label: "Video B-Roll", color: "text-teal-600", bgColor: "bg-teal-500", hoverBg: "hover:bg-teal-400" },
  text: { icon: Type, label: "Text", color: "text-blue-600", bgColor: "bg-blue-500", hoverBg: "hover:bg-blue-400" },
  audio: { icon: Music, label: "Audio", color: "text-purple-600", bgColor: "bg-purple-500", hoverBg: "hover:bg-purple-400" },
  shape: { icon: Shapes, label: "Shapes", color: "text-amber-600", bgColor: "bg-amber-500", hoverBg: "hover:bg-amber-400" },
};

type TrackItem = ITrackItem & {
  id: string;
};

interface GroupedTracks {
  [type: string]: TrackItem[];
}

type DragMode = "move" | "trim-left" | "trim-right" | null;

interface OverlayTracksProps {
  totalDurationMs: number; // Unified duration from parent Timeline
}

const OverlayTracks = ({ totalDurationMs }: OverlayTracksProps) => {
  const { trackItemsMap, trackItemIds, fps, playerRef, setState, selectedTimelineItemId, setTimelineSelection, clearTimelineSelection } = useStore();
  const currentFrame = useCurrentPlayerFrame(playerRef);

  // Drag state
  const [dragItemId, setDragItemId] = useState<string | null>(null);
  const [dragMode, setDragMode] = useState<DragMode>(null);
  const dragStartRef = useRef<{
    startX: number;
    originalFrom: number;
    originalTo: number;
    trackWidth: number;
    totalDurationMs: number;
  } | null>(null);

  // Keep refs for latest values to avoid stale closures in event handlers
  const trackItemsMapRef = useRef(trackItemsMap);
  const setStateRef = useRef(setState);
  useEffect(() => {
    trackItemsMapRef.current = trackItemsMap;
    setStateRef.current = setState;
  }, [trackItemsMap, setState]);

  // NOTE: totalDurationMs is now passed from parent Timeline as a prop
  // This ensures all tracks (overlay, transcript, music) use the same time base

  // Group items by type (excluding main video - that's handled by transcript track)
  const groupedTracks = useMemo((): GroupedTracks => {
    const groups: GroupedTracks = {};

    Object.entries(trackItemsMap).forEach(([id, item]) => {
      // Skip caption items - they're auto-generated
      if (item.type === "caption") return;

      // Handle video items specially - only show B-roll videos (with isBroll metadata)
      if (item.type === "video") {
        if (item.metadata?.isBroll) {
          // This is a B-roll video - put it in the video-broll group
          if (!groups["video-broll"]) {
            groups["video-broll"] = [];
          }
          groups["video-broll"].push({ ...item, id } as TrackItem);
          console.log(`[OverlayTracks] Found B-roll video in DesignCombo:`, {
            id,
            from: item.display?.from,
            to: item.display?.to,
          });
        }
        // Skip non-B-roll videos - they're handled by transcript track
        return;
      }

      if (!groups[item.type]) {
        groups[item.type] = [];
      }
      groups[item.type].push({ ...item, id } as TrackItem);
    });

    // Debug logging for B-roll tracking
    if (groups.image && groups.image.length > 0) {
      console.log(`[OverlayTracks] Found ${groups.image.length} B-roll images:`, groups.image.map(i => ({
        id: i.id,
        from: i.display?.from,
        to: i.display?.to,
        src: i.details?.src?.substring(0, 50) + "...",
      })));
    }

    return groups;
  }, [trackItemsMap]);

  // Sort groups by priority
  const sortedTypes = useMemo(() => {
    const priority = ["text", "image", "audio", "shape"];
    return Object.keys(groupedTracks).sort((a, b) => {
      const aIndex = priority.indexOf(a);
      const bIndex = priority.indexOf(b);
      if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });
  }, [groupedTracks]);

  // Current playhead position
  const currentTimeMs = (currentFrame / fps) * 1000;
  const playheadPercent = totalDurationMs > 0
    ? Math.min((currentTimeMs / totalDurationMs) * 100, 100)
    : 0;

  // Handle drag start - get track width from the clicked element's track container
  const handleDragStart = useCallback((
    e: React.MouseEvent,
    itemId: string,
    mode: DragMode,
    item: TrackItem
  ) => {
    e.preventDefault();
    e.stopPropagation();

    // Find the track content area (parent with class 'track-content')
    const trackEl = (e.currentTarget as HTMLElement).closest('.track-content') as HTMLElement;
    if (!trackEl) {
      console.error('Could not find track content element');
      return;
    }

    const trackWidth = trackEl.clientWidth;

    setDragItemId(itemId);
    setDragMode(mode);
    dragStartRef.current = {
      startX: e.clientX,
      originalFrom: item.display?.from || 0,
      originalTo: item.display?.to || 3000,
      trackWidth,
      totalDurationMs,
    };
  }, [totalDurationMs]);

  // Handle mouse move for dragging
  useEffect(() => {
    if (!dragItemId || !dragMode) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;

      const { startX, originalFrom, originalTo, trackWidth, totalDurationMs } = dragStartRef.current;
      const deltaX = e.clientX - startX;
      const deltaMs = (deltaX / trackWidth) * totalDurationMs;

      const duration = originalTo - originalFrom;
      let newFrom = originalFrom;
      let newTo = originalTo;

      if (dragMode === "move") {
        // Move the whole item
        newFrom = Math.max(0, originalFrom + deltaMs);
        newTo = newFrom + duration;
        // Clamp to total duration
        if (newTo > totalDurationMs) {
          newTo = totalDurationMs;
          newFrom = newTo - duration;
        }
      } else if (dragMode === "trim-left") {
        // Adjust start time
        newFrom = Math.max(0, Math.min(originalTo - 500, originalFrom + deltaMs));
      } else if (dragMode === "trim-right") {
        // Adjust end time
        newTo = Math.max(originalFrom + 500, Math.min(totalDurationMs, originalTo + deltaMs));
      }

      const roundedFrom = Math.round(newFrom);
      const roundedTo = Math.round(newTo);

      // Update Zustand store directly for immediate UI feedback
      const currentTrackItemsMap = trackItemsMapRef.current;
      const currentItem = currentTrackItemsMap[dragItemId];
      if (currentItem) {
        const newTrackItemsMap = {
          ...currentTrackItemsMap,
          [dragItemId]: {
            ...currentItem,
            display: {
              ...currentItem.display,
              from: roundedFrom,
              to: roundedTo,
            },
          },
        };
        setStateRef.current({ trackItemsMap: newTrackItemsMap });
        trackItemsMapRef.current = newTrackItemsMap; // Update ref for next move
      }

      // Also dispatch to DesignCombo state manager for persistence
      // Wrap in try-catch as DesignCombo can throw if state isn't ready
      try {
        dispatch(EDIT_OBJECT, {
          payload: {
            [dragItemId]: {
              display: {
                from: roundedFrom,
                to: roundedTo,
              },
            },
          },
        });
      } catch (e) {
        // Silently ignore - Zustand update above is already applied
        console.warn("[OverlayTracks] Failed to dispatch to DesignCombo:", e);
      }
    };

    const handleMouseUp = () => {
      setDragItemId(null);
      setDragMode(null);
      dragStartRef.current = null;
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragItemId, dragMode]);

  // Handle click to seek (and clear selection if clicking empty space)
  const handleTrackClick = useCallback((e: React.MouseEvent) => {
    const trackEl = (e.target as HTMLElement).closest('.track-content') as HTMLElement;
    if (!trackEl || !playerRef?.current || totalDurationMs <= 0) return;
    if (dragItemId) return;

    // Clear selection if clicking empty space (not on an overlay item)
    const clickedOnItem = (e.target as HTMLElement).closest('.overlay-item');
    if (!clickedOnItem) {
      clearTimelineSelection();
    }

    const rect = trackEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, x / rect.width));
    const targetMs = ratio * totalDurationMs;
    const targetFrame = Math.round((targetMs / 1000) * fps);

    playerRef.current.seekTo(targetFrame);
  }, [playerRef, totalDurationMs, fps, dragItemId, clearTimelineSelection]);

  // Handle click on track label to seek to start (time 0)
  const handleLabelClick = useCallback(() => {
    if (!playerRef?.current) return;
    playerRef.current.seekTo(0);
    clearTimelineSelection();
  }, [playerRef, clearTimelineSelection]);

  // Don't render if no overlay items or no duration (avoids division by zero)
  if (sortedTypes.length === 0 || totalDurationMs <= 0) {
    return null;
  }

  return (
    <div className="flex flex-col border-b border-border/50">
      {sortedTypes.map((type) => {
        const items = groupedTracks[type];
        const config = TRACK_CONFIG[type] || {
          icon: Shapes,
          label: type.charAt(0).toUpperCase() + type.slice(1),
          color: "text-gray-600",
          bgColor: "bg-gray-500",
          hoverBg: "hover:bg-gray-400",
        };
        const Icon = config.icon;

        return (
          <div
            key={type}
            className="flex items-center h-12 border-b border-border/30 last:border-b-0 cursor-pointer"
            onClick={(e) => {
              // Handle clicks on borders/gaps - only if not clicking on interactive elements
              const target = e.target as HTMLElement;
              if (target.closest('button')) return;
              if (target.closest('.trim-handle')) return;
              if (target.closest('.overlay-item')) return;
              if (target.closest('.track-content')) return; // Let track-content handle its own clicks
              if (target.closest('.cursor-pointer')?.querySelector('svg, span.truncate')) return; // Let label handle its own clicks
              
              // Calculate time based on track-content position
              const trackContent = e.currentTarget.querySelector('.track-content') as HTMLElement;
              if (!trackContent || !playerRef?.current || totalDurationMs <= 0) return;
              
              const rect = trackContent.getBoundingClientRect();
              const x = e.clientX - rect.left;
              const ratio = Math.max(0, Math.min(1, x / rect.width));
              const targetMs = ratio * totalDurationMs;
              const targetFrame = Math.round((targetMs / 1000) * fps);
              
              playerRef.current.seekTo(targetFrame);
              clearTimelineSelection();
            }}
          >
            {/* Track label */}
            <div 
              className={cn(
                "flex items-center gap-1.5 px-3 w-20 shrink-0 text-xs font-medium cursor-pointer hover:opacity-80 transition-opacity",
                config.color
              )}
              onClick={handleLabelClick}
            >
              <Icon className="w-3.5 h-3.5" />
              <span className="truncate">{config.label}</span>
            </div>

            {/* Track content area */}
            <div
              className="track-content flex-1 relative h-full bg-muted/30 cursor-pointer"
              onClick={handleTrackClick}
            >
              {/* Playhead line in this track */}
              {totalDurationMs > 0 && (
                <div
                  className="absolute top-0 bottom-0 w-[2px] bg-primary/50 z-10 pointer-events-none"
                  style={{ left: `${playheadPercent}%` }}
                />
              )}

              {/* Items */}
              {items.map((item) => {
                const startMs = item.display?.from || 0;
                const endMs = item.display?.to || startMs + 3000;
                const durationMs = endMs - startMs;

                if (totalDurationMs <= 0) return null;

                const leftPercent = (startMs / totalDurationMs) * 100;
                const widthPercent = (durationMs / totalDurationMs) * 100;
                const isDragging = dragItemId === item.id;
                const isSelected = selectedTimelineItemId === item.id;

                // Get item preview text
                const previewText = type === "video-broll"
                  ? "Video B-Roll"
                  : item.details?.text
                    ? String(item.details.text).substring(0, 15)
                    : item.details?.src
                      ? "Image"
                      : type;

                return (
                  <div
                    key={item.id}
                    className={cn(
                      "overlay-item absolute top-1.5 bottom-1.5 rounded-lg flex items-center text-white text-[10px] font-medium truncate transition-all",
                      config.bgColor,
                      isDragging ? "ring-2 ring-white shadow-lg z-20" : "z-10",
                      !isDragging && "cursor-pointer",
                      isSelected && "ring-2 ring-primary ring-offset-1 ring-offset-background shadow-lg"
                    )}
                    style={{
                      left: `${leftPercent}%`,
                      width: `${Math.max(widthPercent, 3)}%`,
                      minWidth: "60px",
                    }}
                    title={`${previewText} (${formatTime(startMs)} - ${formatTime(endMs)})`}
                    onClick={() => {
                      // Select this item (seek handled by track click)
                      setTimelineSelection(item.id, "overlay-item");
                    }}
                    onMouseDown={(e) => handleDragStart(e, item.id, "move", item)}
                  >
                    {/* Left trim handle */}
                    <div
                      className={cn(
                        "absolute left-0.5 top-1 bottom-1 w-1 rounded-full cursor-ew-resize z-10 transition-all",
                        isDragging && dragMode === "trim-left"
                          ? "bg-white"
                          : "bg-white/30 hover:bg-white"
                      )}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        handleDragStart(e, item.id, "trim-left", item);
                      }}
                    />

                    {/* Content */}
                    <div className="flex-1 px-3 truncate">
                      {previewText}
                    </div>

                    {/* Right trim handle */}
                    <div
                      className={cn(
                        "absolute right-0.5 top-1 bottom-1 w-1 rounded-full cursor-ew-resize z-10 transition-all",
                        isDragging && dragMode === "trim-right"
                          ? "bg-white"
                          : "bg-white/30 hover:bg-white"
                      )}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        handleDragStart(e, item.id, "trim-right", item);
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

export default OverlayTracks;
