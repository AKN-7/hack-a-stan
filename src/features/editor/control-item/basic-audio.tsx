import { ScrollArea } from "@/components/ui/scroll-area";
import { IAudio, ITrackItem } from "@designcombo/types";
import Volume from "./common/volume";
import Speed from "./common/speed";
import React, { useState } from "react";
import { dispatch } from "@designcombo/events";
import { EDIT_OBJECT, LAYER_REPLACE, LAYER_DELETE } from "@designcombo/state";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import useStore from "../store/use-store";

const BasicAudio = ({
  trackItem,
  type
}: {
  trackItem: ITrackItem & IAudio;
  type?: string;
}) => {
  const showAll = !type;
  const [properties, setProperties] = useState(trackItem);
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

  const handleChangeVolume = (v: number) => {
    dispatch(EDIT_OBJECT, {
      payload: {
        [trackItem.id]: {
          details: {
            volume: v
          }
        }
      }
    });

    setProperties((prev) => {
      return {
        ...prev,
        details: {
          ...prev.details,
          volume: v
        }
      };
    });
  };

  const handleChangeSpeed = (v: number) => {
    dispatch(EDIT_OBJECT, {
      payload: {
        [trackItem.id]: {
          playbackRate: v
        }
      }
    });

    setProperties((prev) => {
      return {
        ...prev,
        playbackRate: v
      };
    });
  };

  const components = [
    {
      key: "speed",
      component: (
        <Speed
          value={properties.playbackRate ?? 1}
          onChange={handleChangeSpeed}
        />
      )
    },
    {
      key: "volume",
      component: (
        <Volume
          onChange={(v: number) => handleChangeVolume(v)}
          value={properties.details.volume ?? 100}
        />
      )
    }
  ];

  return (
    <div className="flex flex-1 flex-col">
      <div className="text-text-primary flex h-12 flex-none items-center px-4 text-sm font-medium">
        Audio
      </div>
      <ScrollArea className="h-full">
        <div className="flex flex-col gap-2 px-4 py-4">
          {components
            .filter((comp) => showAll || comp.key === type)
            .map((comp) => (
              <React.Fragment key={comp.key}>{comp.component}</React.Fragment>
            ))}

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

export default BasicAudio;
