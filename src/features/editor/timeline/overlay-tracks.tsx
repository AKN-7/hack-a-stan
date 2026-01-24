import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { Image, Type, Music, Shapes, Trash2 } from "lucide-react";
import useStore from "../store/use-store";
import useTranscriptStore from "../store/use-transcript-store";
import { useCurrentPlayerFrame } from "../hooks/use-current-frame";
import { cn } from "@/lib/utils";
import { ITrackItem } from "@designcombo/types";
import { dispatch } from "@designcombo/events";
import { EDIT_OBJECT, LAYER_DELETE } from "@designcombo/state";

// Track type configuration
const TRACK_CONFIG: Record<string, { icon: React.ElementType; label: string; color: string; bgColor: string; hoverBg: string }> = {
  image: { icon: Image, label: "B-Roll", color: "text-emerald-600", bgColor: "bg-emerald-500", hoverBg: "hover:bg-emerald-400" },
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

const OverlayTracks = () => {
  const { trackItemsMap, trackItemIds, fps, playerRef, setState } = useStore();
  const getTotalDurationMs = useTranscriptStore((s) => s.getTotalDurationMs);
  const currentFrame = useCurrentPlayerFrame(playerRef);

  // Drag state
  const [dragItemId, setDragItemId] = useState<string | null>(null);
  const [dragMode, setDragMode] = useState<DragMode>(null);
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);
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

  // Get total duration from transcript
  const totalDurationMs = useMemo(() => getTotalDurationMs(), [getTotalDurationMs]);

  // Group items by type (excluding video - that's handled by transcript track)
  const groupedTracks = useMemo((): GroupedTracks => {
    const groups: GroupedTracks = {};

    Object.entries(trackItemsMap).forEach(([id, item]) => {
      // Skip video items - they're handled by transcript
      if (item.type === "video") return;
      // Skip caption items - they're auto-generated
      if (item.type === "caption") return;

      if (!groups[item.type]) {
        groups[item.type] = [];
      }
      groups[item.type].push({ ...item, id } as TrackItem);
    });

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

  // Handle delete
  const handleDelete = useCallback((e: React.MouseEvent, itemId: string) => {
    e.preventDefault();
    e.stopPropagation();

    // Update Zustand store directly for immediate UI feedback
    const newTrackItemsMap = { ...trackItemsMap };
    delete newTrackItemsMap[itemId];
    const newTrackItemIds = trackItemIds.filter(id => id !== itemId);
    setState({
      trackItemsMap: newTrackItemsMap,
      trackItemIds: newTrackItemIds,
    });

    // Also dispatch to DesignCombo state manager for persistence
    dispatch(LAYER_DELETE, {
      payload: {
        trackItemIds: [itemId],
      },
    });
  }, [trackItemsMap, trackItemIds, setState]);

  // Handle click to seek
  const handleTrackClick = useCallback((e: React.MouseEvent) => {
    const trackEl = (e.target as HTMLElement).closest('.track-content') as HTMLElement;
    if (!trackEl || !playerRef?.current || totalDurationMs <= 0) return;
    if (dragItemId) return;
    if ((e.target as HTMLElement).closest('.overlay-item')) return;

    const rect = trackEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, x / rect.width));
    const targetMs = ratio * totalDurationMs;
    const targetFrame = Math.round((targetMs / 1000) * fps);

    playerRef.current.seekTo(targetFrame);
  }, [playerRef, totalDurationMs, fps, dragItemId]);

  // Don't render if no overlay items
  if (sortedTypes.length === 0) {
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
            className="flex items-center h-12 border-b border-border/30 last:border-b-0"
          >
            {/* Track label */}
            <div className={cn(
              "flex items-center gap-1.5 px-3 w-20 shrink-0 text-xs font-medium",
              config.color
            )}>
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
                const isHovered = hoveredItemId === item.id;

                // Get item preview text
                const previewText = item.details?.text
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
                      !isDragging && "cursor-grab active:cursor-grabbing"
                    )}
                    style={{
                      left: `${leftPercent}%`,
                      width: `${Math.max(widthPercent, 3)}%`,
                      minWidth: "60px",
                    }}
                    title={`${previewText} (${formatTime(startMs)} - ${formatTime(endMs)})`}
                    onMouseEnter={() => setHoveredItemId(item.id)}
                    onMouseLeave={() => setHoveredItemId(null)}
                    onClick={(e) => {
                      // If not dragging, seek to this item's start time
                      if (!dragItemId && playerRef?.current) {
                        e.stopPropagation();
                        const targetFrame = Math.round((startMs / 1000) * fps);
                        playerRef.current.seekTo(targetFrame);
                      }
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

                    {/* Delete button - show on hover */}
                    {isHovered && !isDragging && (
                      <button
                        className="absolute right-6 top-1/2 -translate-y-1/2 p-1 rounded bg-black/30 hover:bg-red-500 transition-colors z-20"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onClick={(e) => handleDelete(e, item.id)}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}

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
