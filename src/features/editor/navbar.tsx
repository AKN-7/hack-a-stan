import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { dispatch } from "@designcombo/events";
import { HISTORY_UNDO, HISTORY_REDO, DESIGN_RESIZE } from "@designcombo/state";
import { Icons } from "@/components/shared/icons";
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  ChevronDown,
  Download,
  ProportionsIcon
} from "lucide-react";
import { Label } from "@/components/ui/label";

import type StateManager from "@designcombo/state";
import { generateId } from "@designcombo/timeline";
import type { IDesign } from "@designcombo/types";
import { useDownloadState } from "./store/use-download-state";
import useTranscriptStore from "./store/use-transcript-store";
import useStore from "./store/use-store";
import useUploadStore from "./store/use-upload-store";
import useEffectsStore from "./store/use-effects-store";
import useChatStore from "@/features/chat/use-chat-store";
import DownloadProgressModal from "./download-progress-modal";
import AutosizeInput from "@/components/ui/autosize-input";
import { debounce } from "lodash";
import {
  useIsLargeScreen,
  useIsMediumScreen,
  useIsSmallScreen
} from "@/hooks/use-media-query";

import { LogoIcons } from "@/components/shared/logos";

export default function Navbar({
  user,
  stateManager,
  setProjectName,
  projectName
}: {
  user: any | null;
  stateManager: StateManager;
  setProjectName: (name: string) => void;
  projectName: string;
}) {
  const [title, setTitle] = useState(projectName);
  const isLargeScreen = useIsLargeScreen();
  const isMediumScreen = useIsMediumScreen();
  const isSmallScreen = useIsSmallScreen();

  // Get transcript undo/redo functions and reset
  const { undo: transcriptUndo, redo: transcriptRedo, canUndo, canRedo, reset: resetTranscript } = useTranscriptStore();
  const { playerRef, fps, setState: setEditorState } = useStore();
  const { setUploads, setUploadsVideos, setUploadsAudios, setUploadsImages } = useUploadStore();
  const { reset: resetEffects } = useEffectsStore();
  const { clearMessages: clearChatMessages } = useChatStore();
  const [showResetDialog, setShowResetDialog] = useState(false);

  const handleReset = useCallback(() => {
    // Clear transcript store (clips, words, etc.)
    resetTranscript();

    // Clear chat/AI messages
    clearChatMessages();

    // Clear uploads
    setUploads([]);
    setUploadsVideos([]);
    setUploadsAudios([]);
    setUploadsImages([]);

    // Clear effects
    resetEffects();

    // Clear DesignCombo state (overlays, text, images, etc.)
    setEditorState({
      trackItemsMap: {},
      trackItemIds: [],
    });

    setShowResetDialog(false);
  }, [resetTranscript, clearChatMessages, setUploads, setUploadsVideos, setUploadsAudios, setUploadsImages, resetEffects, setEditorState]);

  const handleUndo = useCallback(() => {
    // Try transcript undo first (since it's the primary editing mode)
    transcriptUndo();
    // Also dispatch DesignCombo undo for canvas operations
    dispatch(HISTORY_UNDO);
  }, [transcriptUndo]);

  const handleRedo = useCallback(() => {
    // Try transcript redo first (since it's the primary editing mode)
    transcriptRedo();
    // Also dispatch DesignCombo redo for canvas operations
    dispatch(HISTORY_REDO);
  }, [transcriptRedo]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if user is typing in an input/textarea
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA" ||
        (document.activeElement as HTMLElement)?.isContentEditable
      ) {
        return;
      }

      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const ctrlOrCmd = isMac ? e.metaKey : e.ctrlKey;

      // Space: Play/Pause
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        const player = playerRef?.current;
        if (player) {
          const isPlaying = player.isPlaying();
          if (isPlaying) {
            player.pause();
          } else {
            player.play();
          }
        }
        return;
      }

      // Arrow Left: Seek backward (1 frame, or 30 frames with Shift)
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        const player = playerRef?.current;
        if (player) {
          const currentFrame = player.getCurrentFrame();
          const step = e.shiftKey ? 30 : 1;
          player.seekTo(Math.max(0, currentFrame - step));
        }
        return;
      }

      // Arrow Right: Seek forward (1 frame, or 30 frames with Shift)
      if (e.key === "ArrowRight") {
        e.preventDefault();
        const player = playerRef?.current;
        if (player) {
          const currentFrame = player.getCurrentFrame();
          const step = e.shiftKey ? 30 : 1;
          player.seekTo(currentFrame + step);
        }
        return;
      }

      // Undo: Ctrl+Z / Cmd+Z
      if (ctrlOrCmd && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
        return;
      }

      // Redo: Ctrl+Shift+Z / Cmd+Shift+Z or Ctrl+Y (Windows)
      if (
        (ctrlOrCmd && e.key.toLowerCase() === "z" && e.shiftKey) ||
        (ctrlOrCmd && e.key.toLowerCase() === "y")
      ) {
        e.preventDefault();
        handleRedo();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleUndo, handleRedo, playerRef]);

  const handleCreateProject = async () => {};

  // Create a debounced function for setting the project name
  const debouncedSetProjectName = useCallback(
    debounce((name: string) => {
      console.log("Debounced setProjectName:", name);
      setProjectName(name);
    }, 2000), // 2 seconds delay
    []
  );

  // Update the debounced function whenever the title changes
  useEffect(() => {
    debouncedSetProjectName(title);
  }, [title, debouncedSetProjectName]);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTitle(e.target.value);
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: isSmallScreen ? "auto 1fr auto" : isLargeScreen ? "320px 1fr 320px" : "1fr 1fr 1fr"
      }}
      className="pointer-events-none flex h-14 items-center bg-white border-b border-border px-2 md:px-4 shadow-sm"
    >
      <DownloadProgressModal />

      <div className="flex items-center gap-2 md:gap-3">
        <Dialog open={showResetDialog} onOpenChange={setShowResetDialog}>
          <DialogTrigger asChild>
            <button className="pointer-events-auto flex h-9 w-9 md:h-10 md:w-10 items-center justify-center rounded-xl bg-primary text-white shadow-sm hover:bg-primary/90 transition-colors cursor-pointer">
              <LogoIcons.scenify />
            </button>
          </DialogTrigger>
          <DialogContent showCloseButton={false} className="w-[90vw] max-w-md mx-auto">
            <DialogHeader>
              <DialogTitle>Start a new project?</DialogTitle>
              <DialogDescription>
                This will clear all your current clips and edits. You'll be taken back to the upload screen to start fresh.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button variant="outline" onClick={() => setShowResetDialog(false)} className="w-full sm:w-auto">
                Cancel
              </Button>
              <Button onClick={handleReset} className="bg-red-500 hover:bg-red-600 text-white w-full sm:w-auto">
                Clear & Start Over
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Undo/Redo - always visible but more compact on mobile */}
        <div className="pointer-events-auto flex h-8 md:h-9 items-center gap-0.5 md:gap-1 rounded-lg bg-muted px-0.5 md:px-1">
          <Button
            onClick={handleUndo}
            className="text-muted-foreground hover:text-foreground hover:bg-white h-7 w-7 md:h-8 md:w-8"
            variant="ghost"
            size="icon"
          >
            <Icons.undo width={isSmallScreen ? 16 : 18} />
          </Button>
          <Button
            onClick={handleRedo}
            className="text-muted-foreground hover:text-foreground hover:bg-white h-7 w-7 md:h-8 md:w-8"
            variant="ghost"
            size="icon"
          >
            <Icons.redo width={isSmallScreen ? 16 : 18} />
          </Button>
        </div>
      </div>

      <div className="flex h-11 items-center justify-center gap-2">
        {!isSmallScreen && (
          <div className="pointer-events-auto flex h-9 items-center gap-2 rounded-lg bg-muted px-3">
            <AutosizeInput
              name="title"
              value={title}
              onChange={handleTitleChange}
              width={200}
              inputClassName="border-none outline-none px-1 bg-transparent text-sm font-semibold text-foreground"
            />
          </div>
        )}
      </div>

      <div className="flex h-11 items-center justify-end gap-2 md:gap-3">
        <div className="pointer-events-auto flex h-10 items-center">
          <DownloadPopover stateManager={stateManager} />
        </div>
      </div>
    </div>
  );
}

const DownloadPopover = ({ stateManager }: { stateManager: StateManager }) => {
  const isMediumScreen = useIsMediumScreen();
  const isSmallScreen = useIsSmallScreen();
  const { actions, exportType } = useDownloadState();
  const [isExportTypeOpen, setIsExportTypeOpen] = useState(false);
  const [open, setOpen] = useState(false);

  const handleExport = () => {
    const data: IDesign = {
      id: generateId(),
      ...stateManager.toJSON()
    };

    console.log({ data });

    actions.setState({ payload: data });
    actions.startExport();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          className="flex h-8 md:h-9 gap-1.5 md:gap-2 rounded-lg bg-primary hover:bg-primary/90 text-white font-semibold shadow-md shadow-primary/25 transition-all duration-200 border-0 px-2.5 md:px-3"
          size={isMediumScreen ? "sm" : "icon"}
        >
          <Download width={isSmallScreen ? 14 : 16} />
          <span className="hidden md:block">Export</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="z-[250] flex w-60 flex-col gap-4 bg-white border border-border shadow-xl rounded-xl"
        sideOffset={8}
      >
        <Label>Export settings</Label>

        <Popover open={isExportTypeOpen} onOpenChange={setIsExportTypeOpen}>
          <PopoverTrigger asChild>
            <Button className="w-full justify-between" variant="outline">
              <div>{exportType.toUpperCase()}</div>
              <ChevronDown width={16} />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="bg-background z-[251] w-[--radix-popover-trigger-width] px-2 py-2">
            <div
              className="flex h-7 items-center rounded-sm px-3 text-sm hover:cursor-pointer hover:bg-accent"
              onClick={() => {
                actions.setExportType("mp4");
                setIsExportTypeOpen(false);
              }}
            >
              MP4
            </div>
            <div
              className="flex h-7 items-center rounded-sm px-3 text-sm hover:cursor-pointer hover:bg-accent"
              onClick={() => {
                actions.setExportType("json");
                setIsExportTypeOpen(false);
              }}
            >
              JSON
            </div>
          </PopoverContent>
        </Popover>

        <div>
          <Button onClick={handleExport} className="w-full">
            Export
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

interface ResizeOptionProps {
  label: string;
  icon: string;
  value: ResizeValue;
  description: string;
}

interface ResizeValue {
  width: number;
  height: number;
  name: string;
}

const RESIZE_OPTIONS: ResizeOptionProps[] = [
  {
    label: "16:9",
    icon: "landscape",
    description: "YouTube ads",
    value: {
      width: 1920,
      height: 1080,
      name: "16:9"
    }
  },
  {
    label: "9:16",
    icon: "portrait",
    description: "TikTok, YouTube Shorts",
    value: {
      width: 1080,
      height: 1920,
      name: "9:16"
    }
  },
  {
    label: "1:1",
    icon: "square",
    description: "Instagram, Facebook posts",
    value: {
      width: 1080,
      height: 1080,
      name: "1:1"
    }
  }
];

const ResizeVideo = () => {
  const handleResize = (options: ResizeValue) => {
    dispatch(DESIGN_RESIZE, {
      payload: {
        ...options
      }
    });
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button className="z-10 h-7 gap-2" variant="outline" size={"sm"}>
          <ProportionsIcon className="h-4 w-4" />
          <div>Resize</div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="z-[250] w-60 px-2.5 py-3">
        <div className="text-sm">
          {RESIZE_OPTIONS.map((option, index) => (
            <ResizeOption
              key={index}
              label={option.label}
              icon={option.icon}
              value={option.value}
              handleResize={handleResize}
              description={option.description}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};

const ResizeOption = ({
  label,
  icon,
  value,
  description,
  handleResize
}: ResizeOptionProps & { handleResize: (payload: ResizeValue) => void }) => {
  const Icon = Icons[icon as "text"];
  return (
    <div
      onClick={() => handleResize(value)}
      className="flex cursor-pointer items-center rounded-md p-2 hover:bg-accent"
    >
      <div className="w-8 text-muted-foreground">
        <Icon size={20} />
      </div>
      <div>
        <div>{label}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
    </div>
  );
};
