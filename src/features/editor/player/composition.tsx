import { SequenceItem } from "./sequence-item";
import { useEffect, useState, useMemo } from "react";
import { dispatch, filter, subject } from "@designcombo/events";
import { EDIT_OBJECT, ENTER_EDIT_MODE } from "@designcombo/state";
import { groupTrackItems } from "../utils/track-items";
import { TransitionSeries, Transitions } from "@designcombo/transitions";
import { TransitionSeries as VideoTransitionSeries, linearTiming, fade } from "./transitions";
import { calculateTextHeight } from "../utils/text";
import { calculateSegmentFrames } from "../utils/segment-frames";
import { AbsoluteFill, Sequence, Video, Audio, useCurrentFrame, prefetch } from "remotion";
import useStore from "../store/use-store";
import useTranscriptStore from "../store/use-transcript-store";
import useEffectsStore from "../store/use-effects-store";
import { AnimatedCaptions } from "@/TranscriptVideo/AnimatedCaptions";
import { EmphasisZoom } from "@/TranscriptVideo/EmphasisZoom";

const Composition = () => {
  const [editableTextId, setEditableTextId] = useState<string | null>(null);
  const {
    trackItemIds,
    trackItemsMap,
    fps,
    sceneMoveableRef,
    size,
    transitionsMap,
    structure,
    activeIds
  } = useStore();
  const frame = useCurrentFrame();

  // Subscribe to actual state to trigger re-renders when transcription completes
  const clips = useTranscriptStore((state) => state.clips);
  const clipOrder = useTranscriptStore((state) => state.clipOrder);
  const getRenderSegments = useTranscriptStore((state) => state.getRenderSegments);
  const getCaptionsForRender = useTranscriptStore((state) => state.getCaptionsForRender);
  const emphasisPointsRaw = useTranscriptStore((state) => state.emphasisPoints);
  const getEmphasisPointsForRender = useTranscriptStore((state) => state.getEmphasisPointsForRender);
  // Text hook - rendered as timeline item if available, fallback to direct render otherwise
  const textHook = useTranscriptStore((state) => state.textHook);
  // Check if text hook exists as a timeline item (id starts with "text-hook-")
  const hasTextHookItem = Object.keys(trackItemsMap).some(id => id.startsWith("text-hook-"));

  // Audio + B-roll scenario handling
  const hasAudioBrollScenario = useTranscriptStore((state) => state.hasAudioBrollScenario);
  const hasAudioClipsNeedingBroll = useTranscriptStore((state) => state.hasAudioClipsNeedingBroll);
  const getBrollAssignments = useTranscriptStore((state) => state.getBrollAssignments);
  const getAudioSegments = useTranscriptStore((state) => state.getAudioSegments);
  const getVideoOnlyClips = useTranscriptStore((state) => state.getVideoOnlyClips);

  // Background music
  const getBackgroundMusicClips = useTranscriptStore((state) => state.getBackgroundMusicClips);
  const getTotalDurationMs = useTranscriptStore((state) => state.getTotalDurationMs);

  // Get transcript-based render segments (now reactive to clips changes)
  const renderSegments = useMemo(() => getRenderSegments(), [clips, clipOrder, getRenderSegments]);
  const hasTranscriptData = renderSegments.length > 0;

  // Check for audio + B-roll scenario (m4a with video_only clips)
  const isAudioBrollMode = useMemo(() => hasAudioBrollScenario(), [clips, clipOrder, hasAudioBrollScenario]);
  const audioSegments = useMemo(() => isAudioBrollMode ? getAudioSegments() : [], [isAudioBrollMode, clips, clipOrder, getAudioSegments]);
  const brollAssignments = useMemo(() => isAudioBrollMode ? getBrollAssignments() : [], [isAudioBrollMode, clips, clipOrder, getBrollAssignments]);

  // Mixed mode: audio_only clips interleaved with video_with_audio - still need B-roll over audio segments
  const needsMixedModeBroll = useMemo(() => {
    return !isAudioBrollMode && hasAudioClipsNeedingBroll();
  }, [isAudioBrollMode, clips, clipOrder, hasAudioClipsNeedingBroll]);

  // Calculate B-roll assignments for mixed mode (based on audio_only segments in renderSegments)
  const mixedModeBrollAssignments = useMemo(() => {
    if (!needsMixedModeBroll) return [];

    const videoOnlyClips = getVideoOnlyClips();
    if (videoOnlyClips.length === 0) return [];

    // Find audio_only segments from renderSegments
    const audioOnlySegments = renderSegments.filter(seg => seg.clipType === "audio_only");
    if (audioOnlySegments.length === 0) return [];

    const assignments: Array<{
      clipId: string;
      clipUrl: string;
      startMs: number;
      endMs: number;
      durationMs: number;
      timelineStartMs: number;
      timelineEndMs: number;
    }> = [];

    let brollIndex = 0;
    const brollCount = videoOnlyClips.length;

    // For each audio_only segment, assign B-roll (looping if needed)
    for (const audioSeg of audioOnlySegments) {
      let coveredDuration = 0;
      const segmentDuration = audioSeg.durationMs;

      // Fill this audio segment with B-roll (may need multiple B-roll clips)
      while (coveredDuration < segmentDuration) {
        const brollClip = videoOnlyClips[brollIndex % brollCount];
        const brollDuration = brollClip.durationMs || 10000;
        const remainingDuration = segmentDuration - coveredDuration;
        const useDuration = Math.min(brollDuration, remainingDuration);

        assignments.push({
          clipId: brollClip.clipId,
          clipUrl: brollClip.url,
          startMs: 0,
          endMs: useDuration,
          durationMs: useDuration,
          timelineStartMs: audioSeg.offsetMs + coveredDuration,
          timelineEndMs: audioSeg.offsetMs + coveredDuration + useDuration,
        });

        coveredDuration += useDuration;
        brollIndex++;
      }
    }

    console.log(`[Mixed B-roll] Assigned ${assignments.length} B-roll segments over ${audioOnlySegments.length} audio segments`);
    return assignments;
  }, [needsMixedModeBroll, renderSegments, clips, clipOrder, getVideoOnlyClips]);

  // Get transition settings for cross-dissolve smoothing
  const transitions = useEffectsStore((state) => state.transitions);
  const transitionFrames = useMemo(() => {
    if (!transitions.enabled || transitions.type === "none") return 0;
    return Math.round((transitions.durationMs / 1000) * fps);
  }, [transitions.enabled, transitions.type, transitions.durationMs, fps]);

  // Get caption settings
  const captionSettings = useEffectsStore((state) => state.captions);

  // Get word-level captions for animated display
  const captions = useMemo(() => getCaptionsForRender(), [clips, clipOrder, getCaptionsForRender]);

  // Get emphasis points for zoom effects (AI-detected important moments)
  const emphasisPoints = useMemo(() => getEmphasisPointsForRender(), [emphasisPointsRaw, clips, clipOrder, getEmphasisPointsForRender]);
  const hasEmphasisPoints = emphasisPoints.length > 0;

  // Get background music clips
  const backgroundMusicClips = useMemo(() => getBackgroundMusicClips(), [clips, clipOrder, getBackgroundMusicClips]);
  const totalDurationMs = useMemo(() => getTotalDurationMs(), [clips, clipOrder, getTotalDurationMs]);
  const totalDurationFrames = Math.ceil((totalDurationMs / 1000) * fps);

  // Memoize groupTrackItems to avoid O(n²) calculation every frame
  const groupedItems = useMemo(() => groupTrackItems({
    trackItemIds,
    transitionsMap,
    trackItemsMap: trackItemsMap
  }), [trackItemIds, transitionsMap, trackItemsMap]);

  // Memoize media items filtering
  const mediaItems = useMemo(() => Object.values(trackItemsMap).filter((item) => {
    return item.type === "video" || item.type === "audio";
  }), [trackItemsMap]);

  const handleTextChange = (id: string, _: string) => {
    const elRef = document.querySelector(`.id-${id}`) as HTMLDivElement;
    const containerDiv = elRef.firstElementChild
      ?.firstElementChild as HTMLDivElement;
    const textDiv = elRef.firstElementChild?.firstElementChild
      ?.firstElementChild?.firstElementChild
      ?.firstElementChild as HTMLDivElement;

    const {
      fontFamily,
      fontSize,
      fontWeight,
      letterSpacing,
      lineHeight,
      textShadow,
      webkitTextStroke,
      textTransform
    } = textDiv.style;
    if (!elRef.innerText) return;

    // Check if any word is wider than current container
    const words = elRef.innerText.split(/\s+/);
    const longestWord = words.reduce(
      (longest, word) => (word.length > longest.length ? word : longest),
      ""
    );

    // Create temporary element to measure longest word width
    const tempDiv = document.createElement("div");
    tempDiv.style.visibility = "hidden";
    tempDiv.style.position = "absolute";
    tempDiv.style.top = "-1000px";
    tempDiv.style.fontSize = fontSize;
    tempDiv.style.fontFamily = fontFamily;
    tempDiv.style.fontWeight = fontWeight;
    tempDiv.style.letterSpacing = letterSpacing;
    tempDiv.textContent = longestWord;
    document.body.appendChild(tempDiv);
    const wordWidth = tempDiv.offsetWidth;
    document.body.removeChild(tempDiv);

    // Expand width if word is wider than current container
    const currentWidth = elRef.clientWidth;
    if (wordWidth > currentWidth) {
      elRef.style.width = `${wordWidth}px`;
      textDiv.style.width = `${wordWidth}px`;
      containerDiv.style.width = `${wordWidth}px`;
    }

    const newHeight = calculateTextHeight({
      family: fontFamily,
      fontSize,
      fontWeight,
      letterSpacing,
      lineHeight,
      text: elRef.innerText || "",
      textShadow: textShadow,
      webkitTextStroke,
      width: elRef.style.width,
      id: id,
      textTransform
    });
    const currentHeight = elRef.clientHeight;
    if (newHeight > currentHeight) {
      elRef.style.height = `${newHeight}px`;
      textDiv.style.height = `${newHeight}px`;
    }
    sceneMoveableRef?.current?.moveable.updateRect();
    sceneMoveableRef?.current?.moveable.forceUpdate();
  };

  const onTextBlur = (id: string, _: string) => {
    const elRef = document.querySelector(`.id-${id}`) as HTMLDivElement;
    const textDiv = elRef.firstElementChild?.firstElementChild
      ?.firstElementChild as HTMLDivElement;
    const {
      fontFamily,
      fontSize,
      fontWeight,
      letterSpacing,
      lineHeight,
      textShadow,
      webkitTextStroke,
      textTransform
    } = textDiv.style;
    const { width } = elRef.style;
    if (!elRef.innerText) return;
    const newHeight = calculateTextHeight({
      family: fontFamily,
      fontSize,
      fontWeight,
      letterSpacing,
      lineHeight,
      text: elRef.innerText || "",
      textShadow: textShadow,
      webkitTextStroke,
      width,
      id: id,
      textTransform
    });
    dispatch(EDIT_OBJECT, {
      payload: {
        [id]: {
          details: {
            height: newHeight
          }
        }
      }
    });
  };

  //   handle track and track item events - updates
  useEffect(() => {
    const stateEvents = subject.pipe(
      filter(({ key }) => key.startsWith(ENTER_EDIT_MODE))
    );

    const subscription = stateEvents.subscribe((obj) => {
      if (obj.key === ENTER_EDIT_MODE) {
        if (editableTextId) {
          // get element by  data-text-id={id}
          const element = document.querySelector(
            `[data-text-id="${editableTextId}"]`
          ) as HTMLDivElement;

          let text = "";
          if (element) {
            for (let i = 0; i < element.childNodes.length; i++) {
              const node = element.childNodes[i];
              if (node.nodeType === Node.TEXT_NODE) {
                const nodeText = node.textContent || "";
                text += nodeText;
              } else if (node.nodeType === Node.ELEMENT_NODE) {
                const nodeText = node.textContent || "";
                text += `\n${nodeText}`;
              }
            }
          }

          if (trackItemIds.includes(editableTextId)) {
            dispatch(EDIT_OBJECT, {
              payload: {
                [editableTextId]: {
                  details: {
                    text: text || ""
                  }
                }
              }
            });
          }
        }
        setEditableTextId(obj.value?.payload.id);
      }
    });
    return () => subscription.unsubscribe();
  }, [editableTextId]);

  // Filter out video items from grouped items when using transcript mode
  // We'll render videos from transcript segments instead
  const nonVideoGroupedItems = useMemo(() => {
    if (!hasTranscriptData) return groupedItems;

    const filtered = groupedItems.map(group =>
      group.filter(item => {
        const trackItem = trackItemsMap[item.id];
        return trackItem && trackItem.type !== "video";
      })
    ).filter(group => group.length > 0);

    return filtered;
  }, [groupedItems, hasTranscriptData, trackItemsMap]);

  // Prefetch all video/audio sources for smooth playback
  useEffect(() => {
    const urlsToFetch: string[] = [];

    // Add regular render segment URLs
    if (renderSegments.length > 0) {
      urlsToFetch.push(...renderSegments.map(s => s.clipUrl));
    }

    // Add B-roll URLs if in audio+broll mode
    if (isAudioBrollMode && brollAssignments.length > 0) {
      urlsToFetch.push(...brollAssignments.map(a => a.clipUrl));
    }

    // Add audio segment URLs if in audio+broll mode
    if (isAudioBrollMode && audioSegments.length > 0) {
      urlsToFetch.push(...audioSegments.map(s => s.clipUrl));
    }

    // Add mixed mode B-roll URLs
    if (mixedModeBrollAssignments.length > 0) {
      urlsToFetch.push(...mixedModeBrollAssignments.map(a => a.clipUrl));
    }

    // Add background music URLs
    if (backgroundMusicClips.length > 0) {
      urlsToFetch.push(...backgroundMusicClips.map(m => m.url));
    }

    if (urlsToFetch.length === 0) return;

    const uniqueUrls = [...new Set(urlsToFetch)];
    const freedSet = new Set<string>();

    const prefetchers = uniqueUrls.map(url => {
      try {
        return { url, handle: prefetch(url, { method: 'blob-url' }) };
      } catch {
        return null;
      }
    });

    return () => {
      prefetchers.forEach(p => {
        if (p && !freedSet.has(p.url)) {
          freedSet.add(p.url);
          try {
            p.handle.free();
          } catch {
            // Already freed or invalid - silently ignore
          }
        }
      });
    };
  }, [renderSegments, isAudioBrollMode, brollAssignments, audioSegments, mixedModeBrollAssignments, backgroundMusicClips]);

  // Pre-calculate frame positions using cumulative approach to avoid rounding drift
  const segmentFrames = useMemo(
    () => calculateSegmentFrames(renderSegments, fps),
    [renderSegments, fps]
  );

  // Calculate B-roll frame positions for audio+broll mode
  const brollFrames = useMemo(() => {
    if (!isAudioBrollMode || brollAssignments.length === 0) return [];

    return brollAssignments.map(assignment => ({
      assignment,
      startFrame: Math.floor((assignment.timelineStartMs / 1000) * fps),
      durationInFrames: Math.ceil((assignment.durationMs / 1000) * fps),
      videoStartFrame: Math.floor((assignment.startMs / 1000) * fps),
      videoEndFrame: Math.floor((assignment.endMs / 1000) * fps),
    }));
  }, [isAudioBrollMode, brollAssignments, fps]);

  // Calculate audio segment frame positions
  const audioFrames = useMemo(() => {
    if (!isAudioBrollMode || audioSegments.length === 0) return [];

    return audioSegments.map(segment => ({
      segment,
      startFrame: Math.floor((segment.offsetMs / 1000) * fps),
      durationInFrames: Math.ceil((segment.durationMs / 1000) * fps),
      audioStartFrame: Math.floor((segment.startMs / 1000) * fps),
      audioEndFrame: Math.floor((segment.endMs / 1000) * fps),
    }));
  }, [isAudioBrollMode, audioSegments, fps]);

  // Calculate mixed mode B-roll frame positions
  const mixedBrollFrames = useMemo(() => {
    if (!needsMixedModeBroll || mixedModeBrollAssignments.length === 0) return [];

    return mixedModeBrollAssignments.map(assignment => ({
      assignment,
      startFrame: Math.floor((assignment.timelineStartMs / 1000) * fps),
      durationInFrames: Math.ceil((assignment.durationMs / 1000) * fps),
      videoStartFrame: Math.floor((assignment.startMs / 1000) * fps),
      videoEndFrame: Math.floor((assignment.endMs / 1000) * fps),
    }));
  }, [needsMixedModeBroll, mixedModeBrollAssignments, fps]);

  // Audio + B-roll content: renders audio clips with B-roll video overlaid
  const audioBrollContent = isAudioBrollMode ? (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {/* Render B-roll video clips as visual track */}
      {brollFrames.map(({ assignment, startFrame, durationInFrames, videoStartFrame, videoEndFrame }, index) => (
        <Sequence
          key={`broll-${assignment.clipId}-${index}`}
          from={startFrame}
          durationInFrames={durationInFrames}
          premountFor={fps}
        >
          <AbsoluteFill style={{ overflow: "hidden" }}>
            <Video
              src={assignment.clipUrl}
              startFrom={videoStartFrame}
              endAt={videoEndFrame}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                transform: "scale(1.05)",
              }}
              // Mute the B-roll video since audio comes from audio_only clip
              muted
            />
          </AbsoluteFill>
        </Sequence>
      ))}

      {/* Render audio from audio_only clips */}
      {audioFrames.map(({ segment, startFrame, durationInFrames, audioStartFrame, audioEndFrame }, index) => (
        <Sequence
          key={`audio-${segment.clipId}-${index}`}
          from={startFrame}
          durationInFrames={durationInFrames}
        >
          <Audio
            src={segment.clipUrl}
            startFrom={audioStartFrame}
            endAt={audioEndFrame}
            volume={segment.volume ?? 1}
          />
        </Sequence>
      ))}
    </AbsoluteFill>
  ) : null;

  // Video content that may be wrapped with EmphasisZoom (for non-audioBroll mode)
  // Handles both video_with_audio clips (render as Video) and audio_only clips (render as Audio)
  const videoContent = hasTranscriptData && !isAudioBrollMode ? (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {transitionFrames > 0 && segmentFrames.length > 1 ? (
        // Use TransitionSeries for smooth cross-dissolve between segments
        <VideoTransitionSeries>
          {segmentFrames.flatMap(({ segment, durationInFrames, videoStartFrame, videoEndFrame }, index) => {
            // Check if this is an audio_only segment - render as Audio, not Video
            const isAudioOnly = segment.clipType === "audio_only";

            const elements: React.ReactNode[] = [
              <VideoTransitionSeries.Sequence
                key={`seq-${segment.clipId}-${index}`}
                durationInFrames={durationInFrames}
              >
                {isAudioOnly ? (
                  // Audio-only clip: render just the audio (black screen with captions)
                  <AbsoluteFill style={{ backgroundColor: "#000" }}>
                    <Audio
                      src={segment.clipUrl}
                      startFrom={videoStartFrame}
                      endAt={videoEndFrame}
                      volume={segment.volume ?? 1}
                    />
                  </AbsoluteFill>
                ) : (
                  // Video with audio: render as normal video
                  <AbsoluteFill style={{ overflow: "hidden" }}>
                    <Video
                      src={segment.clipUrl}
                      startFrom={videoStartFrame}
                      endAt={videoEndFrame}
                      volume={segment.volume ?? 1}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        transform: "scale(1.05)",
                      }}
                    />
                  </AbsoluteFill>
                )}
              </VideoTransitionSeries.Sequence>
            ];

            // Add transition after each segment except the last
            if (index < segmentFrames.length - 1) {
              elements.push(
                <VideoTransitionSeries.Transition
                  key={`trans-${index}`}
                  presentation={fade()}
                  timing={linearTiming({ durationInFrames: transitionFrames })}
                />
              );
            }

            return elements;
          })}
        </VideoTransitionSeries>
      ) : (
        // Standard rendering without transitions
        segmentFrames.map(({ segment, startFrame, durationInFrames, videoStartFrame, videoEndFrame }, index) => {
          // Check if this is an audio_only segment
          const isAudioOnly = segment.clipType === "audio_only";

          return (
            <Sequence
              key={`transcript-${segment.clipId}-${index}`}
              from={startFrame}
              durationInFrames={durationInFrames}
              premountFor={fps}
            >
              {isAudioOnly ? (
                // Audio-only clip: render just the audio (black screen with captions)
                <AbsoluteFill style={{ backgroundColor: "#000" }}>
                  <Audio
                    src={segment.clipUrl}
                    startFrom={videoStartFrame}
                    endAt={videoEndFrame}
                    volume={segment.volume ?? 1}
                  />
                </AbsoluteFill>
              ) : (
                // Video with audio: render as normal video
                <AbsoluteFill style={{ overflow: "hidden" }}>
                  <Video
                    src={segment.clipUrl}
                    startFrom={videoStartFrame}
                    endAt={videoEndFrame}
                    volume={segment.volume ?? 1}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      transform: "scale(1.05)",
                    }}
                  />
                </AbsoluteFill>
              )}
            </Sequence>
          );
        })
      )}
    </AbsoluteFill>
  ) : null;

  return (
    <>
      {/* Audio + B-roll mode: audio clips with B-roll video overlaid */}
      {isAudioBrollMode && audioBrollContent}

      {/* Transcript-driven video rendering with optional emphasis zoom (non-audioBroll mode) */}
      {hasTranscriptData && !isAudioBrollMode && (
        hasEmphasisPoints ? (
          <EmphasisZoom emphasisPoints={emphasisPoints}>
            {videoContent}
          </EmphasisZoom>
        ) : (
          videoContent
        )
      )}

      {/* Mixed mode B-roll: renders B-roll video over audio_only segments in mixed timeline */}
      {needsMixedModeBroll && mixedBrollFrames.length > 0 && (
        <AbsoluteFill>
          {mixedBrollFrames.map(({ assignment, startFrame, durationInFrames, videoStartFrame, videoEndFrame }, index) => (
            <Sequence
              key={`mixed-broll-${assignment.clipId}-${index}`}
              from={startFrame}
              durationInFrames={durationInFrames}
              premountFor={fps}
            >
              <AbsoluteFill style={{ overflow: "hidden" }}>
                <Video
                  src={assignment.clipUrl}
                  startFrom={videoStartFrame}
                  endAt={videoEndFrame}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    transform: "scale(1.05)",
                  }}
                  muted
                />
              </AbsoluteFill>
            </Sequence>
          ))}
        </AbsoluteFill>
      )}

      {/* Non-video timeline items (text, captions, audio, images/B-roll, etc.) */}
      {/* Wrapped in AbsoluteFill with z-index to ensure overlays appear above video */}
      <AbsoluteFill style={{ zIndex: 1 }}>
        {nonVideoGroupedItems.map((group, index) => {
          if (group.length === 0) return null;
          if (group.length === 1) {
            const item = trackItemsMap[group[0].id];
            if (!item) return null;
            return SequenceItem[item.type](item, {
              fps,
              handleTextChange,
              onTextBlur,
              editableTextId,
              frame,
              size,
              isTransition: false
            });
          }
          const firstItem = trackItemsMap[group[0].id];
          if (!firstItem) return null;
          const from = Math.floor((firstItem.display.from / 1000) * fps);
          return (
            <TransitionSeries from={from} key={index}>
              {group.map((item) => {
                if (item.type === "transition") {
                  const durationInFrames = Math.ceil((item.duration / 1000) * fps);
                  return Transitions[item.kind]({
                    durationInFrames,
                    ...size,
                    id: item.id,
                    direction: item.direction
                });
              }
              const trackItem = trackItemsMap[item.id];
              if (!trackItem) return null;
              return SequenceItem[trackItem.type](trackItem, {
                fps,
                handleTextChange,
                editableTextId,
                frame,
                isTransition: true,
                size
              });
            })}
          </TransitionSeries>
        );
      })}
      </AbsoluteFill>

      {/* Fallback: Original video rendering when no transcript data */}
      {!hasTranscriptData && groupedItems.map((group, index) => {
        if (group.length === 1) {
          const item = trackItemsMap[group[0].id];
          if (!item) return null;
          return SequenceItem[item.type](item, {
            fps,
            handleTextChange,
            onTextBlur,
            editableTextId,
            frame,
            size,
            isTransition: false
          });
        }
        const firstItem = trackItemsMap[group[0].id];
        if (!firstItem) return null;
        const from = Math.floor((firstItem.display.from / 1000) * fps);
        return (
          <TransitionSeries from={from} key={index}>
            {group.map((item) => {
              if (item.type === "transition") {
                const durationInFrames = Math.ceil((item.duration / 1000) * fps);
                return Transitions[item.kind]({
                  durationInFrames,
                  ...size,
                  id: item.id,
                  direction: item.direction
                });
              }
              const trackItem = trackItemsMap[item.id];
              if (!trackItem) return null;
              return SequenceItem[trackItem.type](trackItem, {
                fps,
                handleTextChange,
                editableTextId,
                frame,
                isTransition: true,
                size
              });
            })}
          </TransitionSeries>
        );
      })}

      {/* Background music - each clip can be trimmed and positioned */}
      {backgroundMusicClips.map((music, index) => {
        // Calculate frames based on trim or full duration
        const musicDurationMs = music.durationMs || totalDurationMs;
        const trimStart = music.trim?.startMs ?? 0;
        const trimEnd = music.trim?.endMs ?? musicDurationMs;
        const trimmedDurationMs = trimEnd - trimStart;

        // Music plays for its trimmed duration or until video ends
        const effectiveDurationMs = Math.min(trimmedDurationMs, totalDurationMs);
        const durationInFrames = Math.ceil((effectiveDurationMs / 1000) * fps);

        // Audio start/end within the source file
        const audioStartFrame = Math.floor((trimStart / 1000) * fps);
        const audioEndFrame = Math.floor((trimEnd / 1000) * fps);

        return (
          <Sequence
            key={`music-${music.clipId}-${index}`}
            from={0}
            durationInFrames={durationInFrames}
          >
            <Audio
              src={music.url}
              startFrom={audioStartFrame}
              endAt={audioEndFrame}
              volume={music.volume ?? 0.12}
            />
          </Sequence>
        );
      })}

      {/* Animated word-by-word captions with current word highlighting */}
      {/* Emphasis points are passed for combo effect (extra pop on key moments) */}
      {captions.length > 0 && captionSettings.style !== "none" && (
        <AnimatedCaptions
          words={captions}
          windowSize={captionSettings.windowSize}
          style={captionSettings.animationType}
          emphasisPoints={emphasisPoints}
        />
      )}

      {/* Text hook fallback - render directly if timeline item creation failed */}
      {textHook && !hasTextHookItem && (
        <Sequence from={0} durationInFrames={Math.ceil((4000 / 1000) * fps)}>
          <AbsoluteFill style={{ pointerEvents: "none", zIndex: 10 }}>
            <div
              style={{
                position: "absolute",
                top: size.height * 0.06,
                left: "50%",
                transform: "translateX(-50%)",
                width: size.width * 0.75,
                backgroundColor: "#ffffff",
                borderRadius: 40,
                paddingTop: 28,
                paddingBottom: 28,
                paddingLeft: 32,
                paddingRight: 32,
                boxShadow: "0px 4px 16px rgba(0,0,0,0.12)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span
                style={{
                  fontFamily: "Inter, Arial, Helvetica, sans-serif",
                  fontSize: 56,
                  fontWeight: 900,
                  color: "#000000",
                  textAlign: "center",
                  lineHeight: 1.2,
                }}
              >
                {textHook}
              </span>
            </div>
          </AbsoluteFill>
        </Sequence>
      )}
    </>
  );
};

export default Composition;
