import { SequenceItem } from "./sequence-item";
import { useEffect, useState, useMemo } from "react";
import { dispatch, filter, subject } from "@designcombo/events";
import { EDIT_OBJECT, ENTER_EDIT_MODE } from "@designcombo/state";
import { groupTrackItems } from "../utils/track-items";
import { TransitionSeries, Transitions } from "@designcombo/transitions";
import { calculateTextHeight } from "../utils/text";
import { calculateSegmentFrames } from "../utils/segment-frames";
import { AbsoluteFill, Sequence, Video, useCurrentFrame, prefetch } from "remotion";
import useStore from "../store/use-store";
import useTranscriptStore from "../store/use-transcript-store";
import useEffectsStore from "../store/use-effects-store";

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

  // Subscribe to effects store for zoom/transition settings
  const segmentZoom = useEffectsStore((state) => state.segmentZoom);

  // Get transcript-based render segments (now reactive to clips changes)
  const renderSegments = useMemo(() => getRenderSegments(), [clips, clipOrder, getRenderSegments]);
  const hasTranscriptData = renderSegments.length > 0;

  // Get captions (3 words at a time)
  const captions = useMemo(() => getCaptionsForRender(), [clips, clipOrder, getCaptionsForRender]);

  // Calculate current time in the edited (transcript-driven) timeline
  const currentTimeMs = (frame / fps) * 1000;

  // Find current caption based on time
  const currentCaption = useMemo(() => {
    for (const caption of captions) {
      if (currentTimeMs >= caption.startMs && currentTimeMs < caption.endMs) {
        return caption;
      }
    }
    return null;
  }, [captions, currentTimeMs]);

  // Debug: Log trackItemIds to see if images are included
  const imageIdsInTrackItemIds = trackItemIds.filter(id => trackItemsMap[id]?.type === "image");
  if (imageIdsInTrackItemIds.length > 0) {
    console.log(`[Composition] trackItemIds contains ${imageIdsInTrackItemIds.length} image ID(s):`, imageIdsInTrackItemIds);
  }

  const groupedItems = groupTrackItems({
    trackItemIds,
    transitionsMap,
    trackItemsMap: trackItemsMap
  });
  const mediaItems = Object.values(trackItemsMap).filter((item) => {
    return item.type === "video" || item.type === "audio";
  });

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

    // Debug: Log image items being rendered
    const imageItems = filtered.flatMap(group =>
      group.filter(item => trackItemsMap[item.id]?.type === "image")
    );
    if (imageItems.length > 0) {
      console.log(`[Composition] Rendering ${imageItems.length} image(s):`, imageItems.map(item => ({
        id: item.id,
        from: trackItemsMap[item.id]?.display?.from,
        to: trackItemsMap[item.id]?.display?.to,
        src: trackItemsMap[item.id]?.details?.src?.substring(0, 50) + "...",
      })));
    }

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

  return (
    <>
      {/* Transcript-driven video rendering with optional zoom for jump-cut smoothing */}
      {hasTranscriptData && (
        <AbsoluteFill style={{ backgroundColor: "#000" }}>
          {segmentFrames.map(({ segment, startFrame, durationInFrames, videoStartFrame, videoEndFrame }, index) => {
            // Calculate zoom scale based on settings
            let zoomScale = 1;
            if (segmentZoom.enabled) {
              const { amount, pattern } = segmentZoom;
              switch (pattern) {
                case "alternate":
                  // Alternate between normal (1) and zoomed (amount) on each segment
                  zoomScale = index % 2 === 0 ? 1 : amount;
                  break;
                case "all-zoomed":
                  // All segments are zoomed
                  zoomScale = amount;
                  break;
                case "first-normal":
                  // First segment normal, rest zoomed
                  zoomScale = index === 0 ? 1 : amount;
                  break;
              }
            }

            return (
              <Sequence
                key={`transcript-${segment.clipId}-${index}`}
                from={startFrame}
                durationInFrames={durationInFrames}
              >
                <AbsoluteFill
                  style={{
                    transform: zoomScale !== 1 ? `scale(${zoomScale})` : undefined,
                    transformOrigin: "center center",
                  }}
                >
                  <Video
                    src={segment.clipUrl}
                    startFrom={videoStartFrame}
                    endAt={videoEndFrame}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                    }}
                    pauseWhenBuffering
                  />
                </AbsoluteFill>
              </Sequence>
            );
          })}
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
          const from = (firstItem.display.from / 1000) * fps;
          return (
            <TransitionSeries from={from} key={index}>
              {group.map((item) => {
                if (item.type === "transition") {
                  const durationInFrames = (item.duration / 1000) * fps;
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
        const from = (firstItem.display.from / 1000) * fps;
        return (
          <TransitionSeries from={from} key={index}>
            {group.map((item) => {
              if (item.type === "transition") {
                const durationInFrames = (item.duration / 1000) * fps;
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

      {/* Current caption overlay - 3 words at a time */}
      {currentCaption && (
        <div
          style={{
            position: "absolute",
            bottom: "5%",
            left: 0,
            right: 0,
            textAlign: "center",
            pointerEvents: "none",
            zIndex: 9999,
          }}
        >
          <span
            style={{
              color: "#FFFFFF",
              fontSize: 72,
              fontWeight: 900,
              textTransform: "uppercase",
              textShadow: "-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000",
            }}
          >
            {currentCaption.text}
          </span>
        </div>
      )}
    </>
  );
};

export default Composition;
