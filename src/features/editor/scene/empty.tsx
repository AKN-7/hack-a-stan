import useStore from "../store/use-store";
import useUploadStore from "../store/use-upload-store";
import { useEffect, useRef, useState } from "react";
import { Droppable } from "@/components/ui/droppable";
import { DroppableArea } from "./droppable";
import { Upload, Sparkles, Zap, FileVideo } from "lucide-react";
import { Button } from "@/components/ui/button";

const SceneEmpty = () => {
  const [isLoading, setIsLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [desiredSize, setDesiredSize] = useState({ width: 0, height: 0 });
  const { size } = useStore();
  const { setShowUploadModal } = useUploadStore();

  useEffect(() => {
    const container = containerRef.current!;
    const PADDING = 96;
    const containerHeight = container.clientHeight - PADDING;
    const containerWidth = container.clientWidth - PADDING;
    const { width, height } = size;

    const desiredZoom = Math.min(
      containerWidth / width,
      containerHeight / height
    );
    setDesiredSize({
      width: width * desiredZoom,
      height: height * desiredZoom
    });
    setIsLoading(false);
  }, [size]);

  const onSelectFiles = (files: File[]) => {
    console.log({ files });
  };

  return (
    <div ref={containerRef} className="absolute z-40 flex h-full w-full flex-1 pointer-events-none">
      {!isLoading ? (
        <Droppable
          maxFileCount={4}
          maxSize={4 * 1024 * 1024}
          disabled={false}
          onValueChange={onSelectFiles}
          className="h-full w-full flex-1"
        >
          <DroppableArea
            onDragStateChange={setIsDraggingOver}
            className={`pointer-events-auto absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 transform items-center justify-center rounded-2xl transition-colors duration-150 ${
              isDraggingOver ? "border-2 border-dashed border-primary bg-primary/5" : "bg-gradient-to-br from-zinc-900 to-black"
            }`}
            style={{
              width: desiredSize.width,
              height: desiredSize.height,
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)"
            }}
          >
            {/* Onboarding Content */}
            <div className="flex flex-col items-center justify-center gap-6 p-8 text-center max-w-md">
              {/* Icon */}
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-lg shadow-primary/25">
                <FileVideo className="w-10 h-10 text-white" />
              </div>

              {/* Text */}
              <div className="space-y-2">
                <h2 className="text-xl font-semibold text-white">Create your video</h2>
                <p className="text-sm text-zinc-400 max-w-xs">
                  Upload your clips and edit by deleting words from the transcript. It's that simple.
                </p>
              </div>

              {/* Upload Button */}
              <Button
                onClick={() => setShowUploadModal(true)}
                className="h-12 px-6 rounded-xl bg-primary hover:bg-primary/90 text-white font-semibold shadow-lg shadow-primary/25"
              >
                <Upload className="w-5 h-5 mr-2" />
                Upload your clips
              </Button>

              {/* Features */}
              <div className="flex items-center gap-4 text-xs text-zinc-500">
                <span className="flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> AI-powered editing
                </span>
                <span className="flex items-center gap-1">
                  <Zap className="w-3 h-3" /> Instant transcription
                </span>
              </div>

              {/* Drag hint */}
              <p className="text-xs text-zinc-600">
                or drag and drop videos here
              </p>
            </div>
          </DroppableArea>
        </Droppable>
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Loading...
        </div>
      )}
    </div>
  );
};

export default SceneEmpty;
