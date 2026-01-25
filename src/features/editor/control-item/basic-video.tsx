import { ScrollArea } from "@/components/ui/scroll-area";
import { ITrackItem, IVideo } from "@designcombo/types";
import { Button } from "@/components/ui/button";
import { Volume2, VolumeX, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { dispatch } from "@designcombo/events";
import { EDIT_OBJECT, LAYER_DELETE } from "@designcombo/state";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import useStore from "../store/use-store";

// Speed presets for talking-head content
const SPEED_PRESETS = [
  { label: "0.5x", value: 0.5 },
  { label: "1x", value: 1 },
  { label: "1.5x", value: 1.5 },
  { label: "2x", value: 2 }
];

const BasicVideo = ({
  trackItem,
}: {
  trackItem: ITrackItem & IVideo;
  type?: string;
}) => {
  const [properties, setProperties] = useState(trackItem);
  const [isMuted, setIsMuted] = useState((trackItem.details.volume ?? 100) === 0);
  const { trackItemsMap, trackItemIds, setState } = useStore();

  const handleDelete = () => {
    const newTrackItemsMap = { ...trackItemsMap };
    delete newTrackItemsMap[trackItem.id];
    const newTrackItemIds = trackItemIds.filter(id => id !== trackItem.id);
    setState({
      trackItemsMap: newTrackItemsMap,
      trackItemIds: newTrackItemIds,
    });

    dispatch(LAYER_DELETE, {
      payload: {
        trackItemIds: [trackItem.id],
      },
    });
  };

  const handleToggleMute = () => {
    const newVolume = isMuted ? 100 : 0;
    setIsMuted(!isMuted);

    dispatch(EDIT_OBJECT, {
      payload: {
        [trackItem.id]: {
          details: {
            volume: newVolume
          }
        }
      }
    });

    setProperties((prev) => ({
      ...prev,
      details: {
        ...prev.details,
        volume: newVolume
      }
    }));
  };

  const handleChangeSpeed = (v: number) => {
    dispatch(EDIT_OBJECT, {
      payload: {
        [trackItem.id]: {
          playbackRate: v
        }
      }
    });

    setProperties((prev) => ({
      ...prev,
      playbackRate: v
    }));
  };

  useEffect(() => {
    setProperties(trackItem);
    setIsMuted((trackItem.details.volume ?? 100) === 0);
  }, [trackItem]);

  const currentSpeed = properties.playbackRate ?? 1;

  return (
    <div className="flex flex-1 flex-col">
      <div className="text-text-primary flex h-12 flex-none items-center px-4 text-sm font-medium">
        Video
      </div>
      <ScrollArea className="h-full">
        <div className="flex flex-col gap-6 px-4 py-4">
          {/* Volume - Simple mute toggle */}
          <div className="flex flex-col gap-3">
            <Label className="font-sans text-xs font-semibold text-muted-foreground">
              Volume
            </Label>
            <Button
              variant={isMuted ? "secondary" : "outline"}
              size="sm"
              onClick={handleToggleMute}
              className="w-fit gap-2"
            >
              {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
              {isMuted ? "Muted" : "Audio On"}
            </Button>
          </div>

          {/* Speed - Preset buttons */}
          <div className="flex flex-col gap-3">
            <Label className="font-sans text-xs font-semibold text-muted-foreground">
              Speed
            </Label>
            <div className="flex gap-2">
              {SPEED_PRESETS.map((preset) => (
                <Button
                  key={preset.value}
                  variant={currentSpeed === preset.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleChangeSpeed(preset.value)}
                  className={cn(
                    "flex-1",
                    currentSpeed === preset.value && "ring-2 ring-primary/20"
                  )}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Delete button */}
          <div className="pt-4 mt-4 border-t border-border">
            <Button
              variant="outline"
              className="w-full text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200 hover:border-red-300"
              onClick={handleDelete}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </Button>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
};

export default BasicVideo;
