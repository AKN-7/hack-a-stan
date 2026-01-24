import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useDownloadState } from "./store/use-download-state";
import { Button } from "@/components/ui/button";
import { CircleCheckIcon, Upload, Clapperboard, Sparkles, Download, CheckCircle2, Circle, Loader2 } from "lucide-react";
import { DialogDescription, DialogTitle } from "@radix-ui/react-dialog";
import { download } from "@/utils/download";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

// Confetti piece component
const ConfettiPiece = ({ delay, left, color }: { delay: number; left: number; color: string }) => (
  <div
    className="absolute w-2.5 h-2.5 opacity-0 animate-confetti"
    style={{
      left: `${left}%`,
      backgroundColor: color,
      animationDelay: `${delay}ms`,
      borderRadius: Math.random() > 0.5 ? "50%" : "2px",
      transform: `rotate(${Math.random() * 360}deg)`,
    }}
  />
);

// Confetti burst component
const ConfettiBurst = () => {
  const colors = ["#FFD700", "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7", "#DDA0DD", "#98D8C8"];
  const pieces = Array.from({ length: 50 }, (_, i) => ({
    id: i,
    delay: Math.random() * 500,
    left: Math.random() * 100,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {pieces.map((piece) => (
        <ConfettiPiece key={piece.id} {...piece} />
      ))}
    </div>
  );
};

// Export steps with progress ranges
const EXPORT_STEPS = [
  { id: "upload", label: "Preparing assets", icon: Upload, range: [0, 10] },
  { id: "render", label: "Rendering video", icon: Clapperboard, range: [10, 90] },
  { id: "finalize", label: "Finalizing", icon: Sparkles, range: [90, 99] },
  { id: "complete", label: "Ready to download", icon: Download, range: [100, 100] },
] as const;

const getStepStatus = (stepRange: readonly [number, number], progress: number) => {
  if (progress >= stepRange[1]) return "complete";
  if (progress >= stepRange[0]) return "active";
  return "pending";
};

const DownloadProgressModal = () => {
  const { progress, displayProgressModal, output, error, actions } =
    useDownloadState();
  const isCompleted = progress === 100;
  const [showConfetti, setShowConfetti] = useState(false);

  // Trigger confetti on completion
  useEffect(() => {
    if (isCompleted && displayProgressModal) {
      setShowConfetti(true);
      // Hide confetti after animation completes
      const timer = setTimeout(() => setShowConfetti(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [isCompleted, displayProgressModal]);

  const handleDownload = async () => {
    if (output?.url) {
      await download(output.url, "untitled.mp4");
      console.log("downloading");
    }
  };

  return (
    <Dialog
      open={displayProgressModal}
      onOpenChange={actions.setDisplayProgressModal}
    >
      <DialogContent className="flex h-[627px] flex-col gap-0 bg-background p-0 sm:max-w-[844px]">
        <DialogTitle className="hidden" />
        <DialogDescription className="hidden" />
        <div className="flex h-16 items-center border-b px-4 font-medium">
          Export Video
        </div>

        {error ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
            <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
              <span className="text-3xl">😕</span>
            </div>
            <div className="text-center space-y-2">
              <div className="font-bold text-lg">Export Failed</div>
              <div className="text-muted-foreground text-sm max-w-md">
                {error}
              </div>
            </div>
            <Button variant="outline" onClick={() => actions.setDisplayProgressModal(false)}>
              Close
            </Button>
          </div>
        ) : isCompleted ? (
          <div className="relative flex flex-1 flex-col items-center justify-center gap-6 p-8 overflow-hidden">
            {showConfetti && <ConfettiBurst />}
            <div className="w-20 h-20 rounded-full bg-green-500/10 flex items-center justify-center animate-in zoom-in duration-300">
              <CircleCheckIcon className="w-10 h-10 text-green-500" />
            </div>
            <div className="text-center space-y-2">
              <div className="font-bold text-xl">Your video is ready!</div>
              <div className="text-muted-foreground">
                Click below to download your masterpiece.
              </div>
            </div>
            <Button size="lg" onClick={handleDownload} className="gap-2">
              <Download className="w-4 h-4" />
              Download Video
            </Button>
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
            {/* Progress ring */}
            <div className="relative">
              <svg className="w-32 h-32 transform -rotate-90">
                <circle
                  cx="64"
                  cy="64"
                  r="56"
                  stroke="currentColor"
                  strokeWidth="8"
                  fill="none"
                  className="text-muted/20"
                />
                <circle
                  cx="64"
                  cy="64"
                  r="56"
                  stroke="currentColor"
                  strokeWidth="8"
                  fill="none"
                  strokeLinecap="round"
                  className="text-primary transition-all duration-500"
                  strokeDasharray={`${2 * Math.PI * 56}`}
                  strokeDashoffset={`${2 * Math.PI * 56 * (1 - progress / 100)}`}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-3xl font-bold">{Math.floor(progress)}%</span>
              </div>
            </div>

            {/* Step indicators */}
            <div className="flex items-center gap-2">
              {EXPORT_STEPS.map((step, index) => {
                const status = getStepStatus(step.range, progress);
                const Icon = step.icon;
                return (
                  <div key={step.id} className="flex items-center">
                    <div
                      className={cn(
                        "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-300",
                        status === "complete" && "bg-green-500/10 text-green-500",
                        status === "active" && "bg-primary/10 text-primary",
                        status === "pending" && "bg-muted/50 text-muted-foreground"
                      )}
                    >
                      {status === "complete" ? (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      ) : status === "active" ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Circle className="w-3.5 h-3.5" />
                      )}
                      <span className="hidden sm:inline">{step.label}</span>
                    </div>
                    {index < EXPORT_STEPS.length - 1 && (
                      <div
                        className={cn(
                          "w-4 h-0.5 mx-1 transition-colors duration-300",
                          status === "complete" ? "bg-green-500/50" : "bg-muted/30"
                        )}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            <div className="text-center text-muted-foreground text-sm">
              <div>This may take a few minutes for longer videos.</div>
              <div>You can close this modal - we'll notify you when it's done.</div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default DownloadProgressModal;
