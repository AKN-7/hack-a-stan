import { SequenceItem } from "./sequence-item";
import { useEffect, useState, useMemo } from "react";
import { dispatch, filter, subject } from "@designcombo/events";
import { EDIT_OBJECT, ENTER_EDIT_MODE } from "@designcombo/state";
import { groupTrackItems } from "../utils/track-items";
import { TransitionSeries, Transitions } from "@designcombo/transitions";
import { TransitionSeries as VideoTransitionSeries, linearTiming, fade } from "./transitions";
import { calculateTextHeight } from "../utils/text";
import { calculateSegmentFrames } from "../utils/segment-frames";
import { AbsoluteFill, Sequence, Video, useCurrentFrame, prefetch } from "remotion";
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
  const textHook = useTranscriptStore((state) => state.textHook);

  // Get transcript-based render segments (now reactive to clips changes)
  const renderSegments = useMemo(() => getRenderSegments(), [clips, clipOrder, getRenderSegments]);
  const hasTranscriptData = renderSegments.length > 0;

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

  // Prefetch all video sources for smooth playback
  useEffect(() => {
    if (renderSegments.length === 0) return;

    const uniqueUrls = [...new Set(renderSegments.map(s => s.clipUrl))];
    const prefetchers = uniqueUrls.map(url => {
      try {
        return prefetch(url, { method: 'blob-url' });
      } catch {
        return null;
      }
    });

    return () => {
      prefetchers.forEach(p => {
        try {
          p?.free();
        } catch {
          // Already freed, ignore
        }
      });
    };
  }, [renderSegments]);

  // Pre-calculate frame positions using cumulative approach to avoid rounding drift
  const segmentFrames = useMemo(
    () => calculateSegmentFrames(renderSegments, fps),
    [renderSegments, fps]
  );

  // Video content that may be wrapped with EmphasisZoom
  const videoContent = hasTranscriptData ? (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {transitionFrames > 0 && segmentFrames.length > 1 ? (
        // Use TransitionSeries for smooth cross-dissolve between segments
        <VideoTransitionSeries>
          {segmentFrames.flatMap(({ segment, durationInFrames, videoStartFrame, videoEndFrame }, index) => {
            const elements: React.ReactNode[] = [
              <VideoTransitionSeries.Sequence
                key={`seq-${segment.clipId}-${index}`}
                durationInFrames={durationInFrames}
              >
                <AbsoluteFill style={{ overflow: "hidden" }}>
                  <Video
                    src={segment.clipUrl}
                    startFrom={videoStartFrame}
                    endAt={videoEndFrame}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      transform: "scale(1.05)",
                    }}
                  />
                </AbsoluteFill>
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
        segmentFrames.map(({ segment, startFrame, durationInFrames, videoStartFrame, videoEndFrame }, index) => (
          <Sequence
            key={`transcript-${segment.clipId}-${index}`}
            from={startFrame}
            durationInFrames={durationInFrames}
            premountFor={fps}
          >
            <AbsoluteFill style={{ overflow: "hidden" }}>
              <Video
                src={segment.clipUrl}
                startFrom={videoStartFrame}
                endAt={videoEndFrame}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  transform: "scale(1.05)",
                }}
              />
            </AbsoluteFill>
          </Sequence>
        ))
      )}
    </AbsoluteFill>
  ) : null;

  return (
    <>
      {/* Transcript-driven video rendering with optional emphasis zoom */}
      {hasTranscriptData && (
        hasEmphasisPoints ? (
          <EmphasisZoom emphasisPoints={emphasisPoints}>
            {videoContent}
          </EmphasisZoom>
        ) : (
          videoContent
        )
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

      {/* Animated word-by-word captions with current word highlighting */}
      {captions.length > 0 && captionSettings.style !== "none" && (
        <AnimatedCaptions
          words={captions}
          windowSize={captionSettings.windowSize}
          style={captionSettings.animationType}
        />
      )}

      {/* Text hook rendered directly (bypasses DesignCombo animation system) */}
      {textHook && (
        <Sequence from={0} durationInFrames={Math.ceil((4000 / 1000) * fps)}>
          <AbsoluteFill style={{ pointerEvents: "none", zIndex: 10 }}>
            <div
              style={{
                position: "absolute",
                top: size.height * 0.05,
                left: "50%",
                transform: "translateX(-50%)",
                width: size.width * 0.7,
                backgroundColor: "#ffffff",
                borderRadius: 16,
                paddingTop: 32,
                paddingBottom: 32,
                paddingLeft: 24,
                paddingRight: 24,
                boxShadow: "0px 4px 12px rgba(0,0,0,0.12)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span
                style={{
                  fontFamily: "Arial, Helvetica, sans-serif",
                  fontSize: 64,
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
