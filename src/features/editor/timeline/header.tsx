import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { dispatch } from "@designcombo/events";
import { PLAYER_PAUSE, PLAYER_PLAY } from "../constants/events";
import { LAYER_DELETE } from "@designcombo/state";
import { frameToTimeString, timeToString } from "../utils/time";
import useStore from "../store/use-store";
import useTranscriptStore from "../store/use-transcript-store";
import { useCurrentPlayerFrame } from "../hooks/use-current-frame";
import { useEffect, useState, useMemo, useCallback } from "react";
import { useIsMobile } from "@/hooks/use-media-query";
import { Trash2, Volume2, VolumeX, Wand2, Loader2, Sparkles } from "lucide-react";

const IconPlayerPlayFilled = ({ size }: { size: number }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    viewBox="0 0 24 24"
    fill="currentColor"
  >
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M6 4v16a1 1 0 0 0 1.524 .852l13 -8a1 1 0 0 0 0 -1.704l-13 -8a1 1 0 0 0 -1.524 .852z" />
  </svg>
);

const IconPlayerPauseFilled = ({ size }: { size: number }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    viewBox="0 0 24 24"
    fill="currentColor"
  >
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M9 4h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h2a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2z" />
    <path d="M17 4h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h2a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2z" />
  </svg>
);

const IconPlayerSkipBack = ({ size }: { size: number }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M20 5v14l-12 -7z" />
    <path d="M4 5l0 14" />
  </svg>
);

const IconPlayerSkipForward = ({ size }: { size: number }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M4 5v14l12 -7z" />
    <path d="M20 5l0 14" />
  </svg>
);

const Header = () => {
  const [playing, setPlaying] = useState(false);
  const isMobile = useIsMobile();
  const {
    fps,
    playerRef,
    duration: storeDurationMs,
    selectedTimelineItemId,
    selectedTimelineItemType,
    clearTimelineSelection,
    trackItemsMap,
    trackItemIds,
    setState
  } = useStore();

  // Subscribe to clips and clipOrder to trigger re-renders when they change
  const clips = useTranscriptStore((s) => s.clips);
  const clipOrder = useTranscriptStore((s) => s.clipOrder);
  const getTotalDurationMs = useTranscriptStore((s) => s.getTotalDurationMs);
  const removeClip = useTranscriptStore((s) => s.removeClip);
  const setClipVolume = useTranscriptStore((s) => s.setClipVolume);
  const startEnhancement = useTranscriptStore((s) => s.startEnhancement);
  const toggleEnhancedAudio = useTranscriptStore((s) => s.toggleEnhancedAudio);

  // Get selected clip info for volume/enhance controls
  const selectedClip = selectedTimelineItemType === "transcript-clip" && selectedTimelineItemId
    ? clips[selectedTimelineItemId]
    : null;
  const clipVolume = selectedClip?.volume ?? 1;
  const enhancementStatus = selectedClip?.enhancementStatus;
  const useEnhancedAudio = selectedClip?.useEnhancedAudio !== false;

  const currentFrame = useCurrentPlayerFrame(playerRef);

  // Get duration in milliseconds - prefer transcript duration, fallback to store duration
  // Store duration is synced by player.tsx when transcript is ready
  const durationMs = useMemo(() => {
    const transcriptDurationMs = getTotalDurationMs();
    // Use transcript duration if available (already edited)
    if (transcriptDurationMs > 0) {
      return transcriptDurationMs;
    }
    // Fallback to store duration (synced by player, in ms)
    return storeDurationMs;
  }, [clips, clipOrder, getTotalDurationMs, storeDurationMs]);

  // Duration in seconds for frame calculations
  const duration = durationMs / 1000;

  const handlePlay = () => {
    dispatch(PLAYER_PLAY);
  };

  const handlePause = () => {
    dispatch(PLAYER_PAUSE);
  };

  const handleSkipBack = () => {
    playerRef?.current?.seekTo(0);
  };

  const handleSkipForward = () => {
    const totalFrames = Math.ceil(duration * fps);
    playerRef?.current?.seekTo(totalFrames);
  };

  const handleDelete = useCallback(() => {
    if (!selectedTimelineItemId) return;

    if (selectedTimelineItemType === "transcript-clip") {
      // Delete transcript clip
      removeClip(selectedTimelineItemId);
    } else if (selectedTimelineItemType === "overlay-item") {
      // Delete overlay item (image, text, audio, etc.)
      const newTrackItemsMap = { ...trackItemsMap };
      delete newTrackItemsMap[selectedTimelineItemId];
      const newTrackItemIds = trackItemIds.filter(id => id !== selectedTimelineItemId);
      setState({
        trackItemsMap: newTrackItemsMap,
        trackItemIds: newTrackItemIds,
      });

      dispatch(LAYER_DELETE, {
        payload: {
          trackItemIds: [selectedTimelineItemId],
        },
      });
    }

    // Clear selection after delete
    clearTimelineSelection();
  }, [selectedTimelineItemId, selectedTimelineItemType, removeClip, trackItemsMap, trackItemIds, setState, clearTimelineSelection]);

  useEffect(() => {
    const player = playerRef?.current;
    if (!player) return;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);

    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onPause);

    return () => {
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onPause);
    };
  }, [playerRef]);

  // Clear selection when clicking outside the timeline
  useEffect(() => {
    if (!selectedTimelineItemId) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Check if click is inside timeline area
      const isInTimeline = target.closest('[data-timeline]');
      const isDeleteButton = target.closest('[data-delete-button]');
      if (!isInTimeline && !isDeleteButton) {
        clearTimelineSelection();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [selectedTimelineItemId, clearTimelineSelection]);

  return (
    <div className={`h-12 md:h-14 flex items-center bg-white border-b border-border px-3 md:px-4 ${
      isMobile ? 'justify-between' : 'gap-3'
    }`}>
      {/* Delete button - aligned left, shows when item selected */}
      {selectedTimelineItemId ? (
        <Button
          onClick={handleDelete}
          variant="ghost"
          size="sm"
          data-delete-button
          className="h-8 px-3 rounded-lg text-muted-foreground hover:text-red-600 hover:bg-red-50"
        >
          <Trash2 className="w-4 h-4 mr-1.5" />
          Delete
        </Button>
      ) : (
        <div className="w-[85px]" />
      )}

      {/* Spacer to center controls */}
      {!isMobile && <div className="flex-1" />}

      {/* Time display - left on mobile */}
      {isMobile && (
        <div className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-muted font-mono">
          <span className="text-sm text-foreground font-semibold tabular-nums">
            {frameToTimeString({ frame: currentFrame }, { fps })}
          </span>
          <span className="text-sm text-muted-foreground">/</span>
          <span className="text-sm text-muted-foreground tabular-nums">
            {timeToString({ time: durationMs })}
          </span>
        </div>
      )}

      {/* Play controls */}
      <div className={`flex items-center ${isMobile ? 'gap-1' : 'gap-1 p-1 rounded-xl bg-muted'}`}>
        <Button
          onClick={handleSkipBack}
          variant="ghost"
          size="icon"
          className={`rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground ${
            isMobile ? 'h-10 w-10' : 'h-8 w-8 hover:bg-white'
          }`}
        >
          <IconPlayerSkipBack size={isMobile ? 18 : 16} />
        </Button>

        <Button
          onClick={() => (playing ? handlePause() : handlePlay())}
          size="icon"
          className={`bg-primary hover:bg-primary/90 text-white shadow-md shadow-primary/25 ${
            isMobile ? 'h-11 w-11 rounded-xl' : 'h-10 w-10 rounded-xl'
          }`}
        >
          {playing ? (
            <IconPlayerPauseFilled size={isMobile ? 20 : 18} />
          ) : (
            <IconPlayerPlayFilled size={isMobile ? 20 : 18} />
          )}
        </Button>

        <Button
          onClick={handleSkipForward}
          variant="ghost"
          size="icon"
          className={`rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground ${
            isMobile ? 'h-10 w-10' : 'h-8 w-8 hover:bg-white'
          }`}
        >
          <IconPlayerSkipForward size={isMobile ? 18 : 16} />
        </Button>
      </div>

      {/* Time display - desktop only (after controls) */}
      {!isMobile && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted text-sm font-mono">
          <span className="text-foreground font-semibold">
            {frameToTimeString({ frame: currentFrame }, { fps })}
          </span>
          <span className="text-muted-foreground">/</span>
          <span className="text-muted-foreground">
            {timeToString({ time: durationMs })}
          </span>
        </div>
      )}

      {/* Right spacer to balance left delete button (desktop) */}
      {!isMobile && <div className="flex-1" />}

      {/* Volume/Enhance controls - shows when transcript clip is selected (RIGHT side) */}
      {!isMobile && selectedClip && selectedTimelineItemType === "transcript-clip" ? (
        <div className="flex items-center gap-3">
          {/* Enhancement controls */}
          {enhancementStatus === "processing" && (
            <div className="flex items-center gap-1.5 text-xs text-blue-600">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Enhancing...</span>
            </div>
          )}
          {enhancementStatus === "completed" && (
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-xs bg-green-100 text-green-700 px-2 py-0.5">
                <Sparkles className="w-3 h-3 mr-1" />
                Enhanced
              </Badge>
              <Switch
                checked={useEnhancedAudio}
                onCheckedChange={() => selectedTimelineItemId && toggleEnhancedAudio(selectedTimelineItemId)}
                className="scale-90"
              />
            </div>
          )}
          {enhancementStatus === "failed" && (
            <Badge variant="secondary" className="text-xs bg-red-100 text-red-700 px-2 py-0.5">
              Failed
            </Badge>
          )}
          {(!enhancementStatus || enhancementStatus === "idle") && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => selectedTimelineItemId && startEnhancement(selectedTimelineItemId)}
              className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <Wand2 className="w-3.5 h-3.5 mr-1.5" />
              Enhance
            </Button>
          )}

          {/* Volume control */}
          <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-muted">
            {clipVolume === 0 ? (
              <VolumeX className="w-4 h-4 text-muted-foreground" />
            ) : (
              <Volume2 className="w-4 h-4 text-muted-foreground" />
            )}
            <Slider
              value={[clipVolume * 100]}
              onValueChange={([v]) => selectedTimelineItemId && setClipVolume(selectedTimelineItemId, v / 100)}
              max={100}
              step={1}
              className="w-20"
            />
            <span className="text-xs text-muted-foreground w-8 text-right font-mono">
              {Math.round(clipVolume * 100)}%
            </span>
          </div>
        </div>
      ) : (
        !isMobile && <div className="w-[85px]" />
      )}
    </div>
  );
};

export default Header;
