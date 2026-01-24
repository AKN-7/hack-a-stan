import { useEffect, useCallback, useRef } from "react";
import StateManager from "@designcombo/state";
import useStore from "../store/use-store";
import useTranscriptStore from "../store/use-transcript-store";
import { IAudio, ITrackItem, IVideo } from "@designcombo/types";
import { audioDataManager } from "../player/lib/audio-data";

// Global registry to prevent duplicate subscriptions
const subscriptionRegistry = new WeakMap<StateManager, Set<string>>();

export const useStateManagerEvents = (stateManager: StateManager) => {
  const { setState } = useStore();
  const { getTotalDurationMs, getRenderSegments } = useTranscriptStore();
  const clipOrder = useTranscriptStore((s) => s.clipOrder);
  const isSubscribedRef = useRef(false);
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Filter out video items from trackItemsMap when we have transcript clips
  // This prevents stale video blocks from showing in the canvas timeline
  const filterVideoItems = useCallback((trackItemsMap: Record<string, ITrackItem>) => {
    if (clipOrder.length === 0) {
      return trackItemsMap; // No transcript clips, keep all items
    }
    // Filter out video items - they're now rendered by TranscriptClipsTrack
    const filtered: Record<string, ITrackItem> = {};
    for (const [id, item] of Object.entries(trackItemsMap)) {
      if (item.type !== "video") {
        filtered[id] = item;
      }
    }
    return filtered;
  }, [clipOrder.length]);

  // Helper to get the effective duration (transcript if available, otherwise timeline)
  const getEffectiveDuration = useCallback((timelineDuration: number) => {
    const renderSegments = getRenderSegments();
    if (renderSegments.length > 0) {
      const transcriptDuration = getTotalDurationMs();
      if (transcriptDuration > 0) {
        return transcriptDuration;
      }
    }
    return timelineDuration;
  }, [getTotalDurationMs, getRenderSegments]);

  // Handle track item updates
  const handleTrackItemUpdate = useCallback(() => {
    const currentState = stateManager.getState();
    const filteredTrackItemsMap = filterVideoItems(currentState.trackItemsMap);
    const audioItems = Object.values(currentState.trackItemsMap).filter(
      (item) => item.type === "audio"
    );
    audioDataManager.setItems(audioItems as (ITrackItem & IAudio)[]);
    audioDataManager.validateUpdateItems(audioItems as (ITrackItem & IAudio)[]);
    setState({
      duration: getEffectiveDuration(currentState.duration),
      trackItemsMap: filteredTrackItemsMap
    });
  }, [stateManager, setState, getEffectiveDuration, filterVideoItems]);

  const handleAddRemoveItems = useCallback(() => {
    const currentState = stateManager.getState();
    const filteredTrackItemsMap = filterVideoItems(currentState.trackItemsMap);
    const filteredTrackItemIds = currentState.trackItemIds.filter(
      (id: string) => filteredTrackItemsMap[id] !== undefined
    );
    const audioItems = Object.values(currentState.trackItemsMap).filter(
      (item) => item.type === "audio"
    );
    audioDataManager.validateUpdateItems(audioItems as (ITrackItem & IAudio)[]);
    setState({
      trackItemsMap: filteredTrackItemsMap,
      trackItemIds: filteredTrackItemIds,
      tracks: currentState.tracks
    });
  }, [stateManager, setState, filterVideoItems]);

  const handleUpdateItemDetails = useCallback(() => {
    const currentState = stateManager.getState();
    const filteredTrackItemsMap = filterVideoItems(currentState.trackItemsMap);
    setState({
      trackItemsMap: filteredTrackItemsMap
    });
  }, [stateManager, setState, filterVideoItems]);

  useEffect(() => {
    console.log("useStateManagerEvents", stateManager);
    // Check if we already have subscriptions for this stateManager
    if (!subscriptionRegistry.has(stateManager)) {
      subscriptionRegistry.set(stateManager, new Set());
    }

    const registry = subscriptionRegistry.get(stateManager);
    if (!registry) return;
    const hookId = "useStateManagerEvents";

    // Prevent duplicate subscriptions
    if (registry.has(hookId)) {
      return;
    }

    registry.add(hookId);
    isSubscribedRef.current = true;

    // Subscribe to state update details
    const resizeDesignSubscription = stateManager.subscribeToUpdateStateDetails(
      (newState) => {
        setState(newState);
      }
    );

    // Subscribe to scale changes
    const scaleSubscription = stateManager.subscribeToScale((newState) => {
      setState(newState);
    });

    // Subscribe to general state changes (filter out video items if we have transcript clips)
    const tracksSubscription = stateManager.subscribeToState((newState) => {
      const filteredState = {
        ...newState,
        trackItemsMap: filterVideoItems(newState.trackItemsMap),
        trackItemIds: newState.trackItemIds?.filter(
          (id: string) => {
            const item = newState.trackItemsMap[id];
            return !item || item.type !== "video" || clipOrder.length === 0;
          }
        )
      };
      setState(filteredState);
    });

    // Subscribe to duration changes (use transcript duration if available)
    const durationSubscription = stateManager.subscribeToDuration(
      (newState) => {
        const effectiveDuration = getEffectiveDuration(newState.duration);
        setState({ ...newState, duration: effectiveDuration });
      }
    );

    // Subscribe to track item updates
    const updateTrackItemsMap = stateManager.subscribeToUpdateTrackItem(
      handleTrackItemUpdate
    );

    // Subscribe to add/remove items
    const itemsDetailsSubscription =
      stateManager.subscribeToAddOrRemoveItems(handleAddRemoveItems);

    // Subscribe to item details updates
    const updateItemDetailsSubscription =
      stateManager.subscribeToUpdateItemDetails(handleUpdateItemDetails);

    // Cleanup function to unsubscribe from all events
    return () => {
      if (isSubscribedRef.current) {
        scaleSubscription.unsubscribe();
        tracksSubscription.unsubscribe();
        durationSubscription.unsubscribe();
        itemsDetailsSubscription.unsubscribe();
        updateTrackItemsMap.unsubscribe();
        updateItemDetailsSubscription.unsubscribe();
        resizeDesignSubscription.unsubscribe();

        // Remove from registry
        registry.delete(hookId);
        isSubscribedRef.current = false;
      }
    };
  }, [
    stateManager,
    setState,
    handleTrackItemUpdate,
    handleAddRemoveItems,
    handleUpdateItemDetails,
    getEffectiveDuration,
    filterVideoItems,
    clipOrder
  ]);

  // Sync timeline duration from transcript (transcript IS the source of truth for video)
  // DesignCombo only handles non-video items (text, audio overlays, etc.)
  useEffect(() => {
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }

    syncTimeoutRef.current = setTimeout(() => {
      const renderSegments = getRenderSegments();
      if (renderSegments.length > 0) {
        const transcriptDuration = getTotalDurationMs();
        if (transcriptDuration > 0) {
          setState({ duration: transcriptDuration });
        }
      }
    }, 50);

    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
  }, [getRenderSegments, getTotalDurationMs, setState]);

  // Initial cleanup: filter out stale video items when we have transcript clips
  useEffect(() => {
    if (clipOrder.length > 0) {
      const currentState = stateManager.getState();
      const filteredTrackItemsMap = filterVideoItems(currentState.trackItemsMap);
      const hasVideoItems = Object.keys(currentState.trackItemsMap).length !==
                            Object.keys(filteredTrackItemsMap).length;

      if (hasVideoItems) {
        const filteredTrackItemIds = currentState.trackItemIds.filter(
          (id: string) => filteredTrackItemsMap[id] !== undefined
        );
        setState({
          trackItemsMap: filteredTrackItemsMap,
          trackItemIds: filteredTrackItemIds
        });
      }
    }
  }, [clipOrder.length, stateManager, setState, filterVideoItems]);
};
