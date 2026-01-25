# Expound: Final 6-Hour Sprint Plan

## Overview
Three improvements to win the hackathon:
1. **Make script-driven editing obvious** (UX issue)
2. **Add voice cleanup** (missing feature from judging criteria)
3. **Auto-generate text hooks in exports** (polish)

---

## 1. SCRIPT-DRIVEN EDITING UX IMPROVEMENTS

### The Problem
Current UX relies on a single small help text line:
> "Click to seek. Select words and press Delete to cut."

Users don't know:
- Words are clickable
- Shift+Click selects ranges
- Ctrl/Cmd+Click toggles selection
- Delete/Backspace cuts video
- There's no visual affordance that words are interactive

### Solution: "Edit Mode" with Visual Cues

#### A. Add Hover Cursor Change (5 min)
**File:** `src/features/editor/menu-item/transcript.tsx` line 541-552

```tsx
// Add cursor-text on hover to signal editability
className={cn(
  "rounded px-0.5 py-0.5 transition-colors duration-100 inline cursor-text",
  // ... rest of classes
)}
```

#### B. Add Sticky Help Banner with Keyboard Shortcuts (15 min)
Replace the tiny help text (line 410-411) with a more prominent, sticky tooltip bar:

```tsx
{/* Sticky help bar - always visible */}
<div className="sticky top-0 z-20 px-4 py-2 bg-gradient-to-r from-primary/5 to-transparent border-b border-primary/10">
  <div className="flex items-center gap-4 text-xs">
    <span className="flex items-center gap-1.5 text-primary font-medium">
      <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-primary/10 text-[10px] font-bold">
        Click
      </span>
      Seek
    </span>
    <span className="flex items-center gap-1.5 text-muted-foreground">
      <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-muted text-[10px] font-bold">
        ⇧
      </span>
      + Click = Select range
    </span>
    <span className="flex items-center gap-1.5 text-red-500 font-medium">
      <span className="inline-flex items-center justify-center px-1.5 h-5 rounded bg-red-100 text-[10px] font-bold">
        Del
      </span>
      Cut video
    </span>
  </div>
</div>
```

#### C. Add "Quick Cut" Buttons Above Transcript (20 min)
Add a row of one-click action buttons that make the editing obvious:

```tsx
{/* Quick edit actions */}
<div className="flex gap-2 px-4 py-3 border-b border-border bg-muted/20">
  <Button
    size="sm"
    variant="outline"
    className="h-8 text-xs"
    onClick={() => {
      const fillerCount = suggestFillerWords();
      toast.success(`Found ${fillerCount} filler words`);
    }}
  >
    <Sparkles className="w-3.5 h-3.5 mr-1.5" />
    Find "um/uh/like"
  </Button>
  <Button
    size="sm"
    variant="outline"
    className="h-8 text-xs"
    onClick={() => {
      const count = autoRemoveFillerWords();
      toast.success(`Removed ${count} filler words`);
    }}
  >
    <Scissors className="w-3.5 h-3.5 mr-1.5" />
    Auto-cut fillers
  </Button>
</div>
```

#### D. Visual Selection Mode Indicator (10 min)
Show how many words are selected with a floating badge:

```tsx
{selectedWordIds.size > 0 && (
  <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2 rounded-full bg-foreground text-background shadow-lg">
    <span className="text-sm font-medium">{selectedWordIds.size} words selected</span>
    <Button
      size="sm"
      variant="ghost"
      className="h-6 px-2 text-xs hover:bg-red-500 hover:text-white"
      onClick={handleDeleteSelected}
    >
      <Trash2 className="w-3 h-3 mr-1" />
      Cut
    </Button>
  </div>
)}
```

#### E. First-Time Tooltip/Onboarding (20 min)
Show a one-time tooltip on first load pointing to the transcript with instructions:

```tsx
// In transcript.tsx, add state for first-time user
const [showOnboarding, setShowOnboarding] = useState(() => {
  if (typeof window === 'undefined') return false;
  return !localStorage.getItem('expound-onboarding-seen');
});

// Onboarding overlay
{showOnboarding && clipOrder.some(id => clips[id]?.status === "ready") && (
  <div className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
    <div className="bg-white rounded-2xl p-6 max-w-sm text-center shadow-2xl">
      <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
        <MousePointerClick className="w-8 h-8 text-primary" />
      </div>
      <h3 className="text-lg font-bold mb-2">Edit by Selecting Text</h3>
      <p className="text-sm text-muted-foreground mb-4">
        Click any word to seek. Select words and press <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">Delete</kbd> to cut that part of the video.
      </p>
      <Button
        className="w-full"
        onClick={() => {
          setShowOnboarding(false);
          localStorage.setItem('expound-onboarding-seen', 'true');
        }}
      >
        Got it
      </Button>
    </div>
  </div>
)}
```

---

## 2. VOICE CLEANUP INTEGRATION

### Best Option for Hackathon: FFmpeg `afftdn` + `loudnorm`

Why FFmpeg over Dolby.io:
- No API costs
- Faster (no network round-trip)
- Already have FFmpeg in the stack (whisper.cpp uses it)
- Can run during render pipeline

### Implementation Plan

#### A. Create Voice Cleanup API Route (30 min)
**File:** `src/app/api/enhance-audio/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { spawn } from "child_process";
import { Readable } from "stream";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

const s3Client = new S3Client({
  region: process.env.REMOTION_AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.REMOTION_AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.REMOTION_AWS_SECRET_ACCESS_KEY!,
  },
});

export async function POST(request: NextRequest) {
  try {
    const { videoUrl } = await request.json();

    // Download video from S3
    const tempId = randomUUID();
    const inputPath = join("/tmp", `${tempId}-input.mp4`);
    const outputPath = join("/tmp", `${tempId}-output.mp4`);

    // Fetch video
    const response = await fetch(videoUrl);
    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(inputPath, buffer);

    // Run FFmpeg with audio enhancement
    await new Promise((resolve, reject) => {
      const ffmpeg = spawn("ffmpeg", [
        "-i", inputPath,
        "-af", [
          "highpass=f=80",           // Remove low rumble
          "lowpass=f=8000",          // Remove high hiss
          "afftdn=nf=-20",           // FFT denoise
          "loudnorm=I=-16:TP=-1.5:LRA=11"  // Normalize loudness
        ].join(","),
        "-c:v", "copy",              // Don't re-encode video
        "-y",                        // Overwrite
        outputPath
      ]);

      ffmpeg.on("close", (code) => {
        if (code === 0) resolve(null);
        else reject(new Error(`FFmpeg exited with code ${code}`));
      });

      ffmpeg.stderr.on("data", (data) => {
        console.log(`FFmpeg: ${data}`);
      });
    });

    // Upload enhanced video to S3
    const enhancedBuffer = await require("fs/promises").readFile(outputPath);
    const enhancedKey = `enhanced/${tempId}.mp4`;

    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.REMOTION_S3_BUCKET,
      Key: enhancedKey,
      Body: enhancedBuffer,
      ContentType: "video/mp4",
    }));

    // Get presigned URL
    const enhancedUrl = await getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: process.env.REMOTION_S3_BUCKET,
        Key: enhancedKey,
      }),
      { expiresIn: 7 * 24 * 60 * 60 }
    );

    // Cleanup temp files
    await Promise.all([unlink(inputPath), unlink(outputPath)]);

    return NextResponse.json({ enhancedUrl });
  } catch (error) {
    console.error("Audio enhancement error:", error);
    return NextResponse.json(
      { error: "Failed to enhance audio" },
      { status: 500 }
    );
  }
}
```

#### B. Add "Enhance Audio" Toggle in Upload Flow (20 min)
**File:** `src/features/editor/store/use-upload-store.ts`

Add a setting:
```typescript
enhanceAudio: boolean;
setEnhanceAudio: (enabled: boolean) => void;
```

Then in the upload processing, after transcription:
```typescript
// If enhance audio is enabled, process the clip
if (get().enhanceAudio) {
  const response = await fetch("/api/enhance-audio", {
    method: "POST",
    body: JSON.stringify({ videoUrl: clip.url }),
  });
  const { enhancedUrl } = await response.json();
  // Update clip URL to enhanced version
  useTranscriptStore.getState().updateClipUrl(clipId, enhancedUrl);
}
```

#### C. Add UI Toggle (10 min)
**File:** `src/features/editor/upload-landing.tsx`

Add a toggle near the upload button:
```tsx
<div className="flex items-center gap-2 mt-4">
  <Switch
    id="enhance-audio"
    checked={enhanceAudio}
    onCheckedChange={setEnhanceAudio}
  />
  <Label htmlFor="enhance-audio" className="text-sm text-muted-foreground">
    Enhance audio (remove noise, normalize volume)
  </Label>
</div>
```

### Alternative: Dolby.io (If FFmpeg doesn't work)

If Lambda doesn't have FFmpeg, use Dolby.io API:

```typescript
// Install: npm install @dolbyio/dolbyio-rest-apis-client

import DolbyIOClient from "@dolbyio/dolbyio-rest-apis-client";

const client = new DolbyIOClient(process.env.DOLBY_API_KEY);

async function enhanceWithDolby(inputUrl: string): Promise<string> {
  const job = await client.media.enhance.start({
    input: { url: inputUrl },
    output: { url: `s3://${bucket}/enhanced/${id}.mp4` },
    content: { type: "podcast" },
  });

  // Poll for completion
  while (true) {
    const status = await client.media.enhance.getStatus(job.job_id);
    if (status.status === "Success") break;
    if (status.status === "Failed") throw new Error("Enhancement failed");
    await new Promise(r => setTimeout(r, 2000));
  }

  return outputUrl;
}
```

---

## 3. TEXT HOOKS IN EXPORTS

### Current State
- `textHook` is stored in `useTranscriptStore`
- It's passed through to `TranscriptVideo` composition
- `TextHookOverlay` renders it for 4 seconds at the top

### Problem
Text hooks are generated by AI but styling is hardcoded (white box, black text).

### Solution: Make Text Hook Configurable + Always Generate

#### A. Extend TextHook to Include Styling (15 min)
**File:** `src/features/editor/store/use-transcript-store.ts`

```typescript
// Add interface
export interface TextHookConfig {
  text: string;
  duration?: number;      // ms, default 4000
  style?: "white-box" | "gradient" | "outline" | "minimal";
  position?: "top" | "center" | "bottom";
  fontSize?: number;      // default 64
  animation?: "fade" | "slide" | "pop";
}

// Replace textHook: string | null with:
textHookConfig: TextHookConfig | null;
setTextHookConfig: (config: TextHookConfig | null) => void;
```

#### B. Auto-Generate Hook on Magic Processing (10 min)
The AI already generates `textHook` in the analyze-cuts response. Make sure it's always applied:

**File:** `src/features/editor/store/use-transcript-store.ts` in `runMagicProcessing()`

```typescript
// After AI analysis returns
if (analysis.textHook) {
  set({
    textHookConfig: {
      text: analysis.textHook,
      duration: 4000,
      style: "white-box",
      position: "top",
    }
  });
}
```

#### C. Update TextHookOverlay for Styles (20 min)
**File:** `src/TranscriptVideo/index.tsx`

```typescript
interface TextHookProps {
  text: string;
  fps: number;
  duration?: number;
  style?: "white-box" | "gradient" | "outline" | "minimal";
  position?: "top" | "center" | "bottom";
  fontSize?: number;
  animation?: "fade" | "slide" | "pop";
}

const TextHookOverlay: React.FC<TextHookProps> = ({
  text,
  fps,
  duration = 4000,
  style = "white-box",
  position = "top",
  fontSize = 64,
  animation = "fade",
}) => {
  const { width, height } = useVideoConfig();
  const frame = useCurrentFrame();
  const durationInFrames = Math.ceil((duration / 1000) * fps);

  // Animation
  const opacity = interpolate(
    frame,
    [0, fps * 0.3, durationInFrames - fps * 0.5, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateRight: "clamp" }
  );

  // Position
  const topPosition = position === "top" ? height * 0.05
    : position === "center" ? height * 0.4
    : height * 0.75;

  // Style presets
  const styles = {
    "white-box": {
      backgroundColor: "#ffffff",
      color: "#000000",
      borderRadius: 16,
      padding: "32px 24px",
      boxShadow: "0px 4px 12px rgba(0,0,0,0.12)",
    },
    "gradient": {
      background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
      color: "#ffffff",
      borderRadius: 16,
      padding: "32px 24px",
    },
    "outline": {
      backgroundColor: "transparent",
      color: "#ffffff",
      WebkitTextStroke: "2px #000000",
    },
    "minimal": {
      backgroundColor: "rgba(0,0,0,0.6)",
      color: "#ffffff",
      borderRadius: 8,
      padding: "16px 20px",
    },
  };

  return (
    <Sequence from={0} durationInFrames={durationInFrames}>
      <AbsoluteFill style={{ pointerEvents: "none", zIndex: 10, opacity }}>
        <div style={{
          position: "absolute",
          top: topPosition,
          left: "50%",
          transform: "translateX(-50%)",
          width: width * 0.8,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          ...styles[style],
        }}>
          <span style={{
            fontFamily: "Arial, Helvetica, sans-serif",
            fontSize,
            fontWeight: 900,
            textAlign: "center",
            lineHeight: 1.2,
            color: styles[style].color,
            WebkitTextStroke: styles[style].WebkitTextStroke,
          }}>
            {text}
          </span>
        </div>
      </AbsoluteFill>
    </Sequence>
  );
};
```

#### D. Add Text Hook Editor in UI (15 min)
**File:** `src/features/editor/menu-item/chat.tsx` or new panel

```tsx
{textHookConfig && (
  <div className="p-4 border-t border-border">
    <div className="flex items-center justify-between mb-2">
      <span className="text-sm font-medium">Opening Hook</span>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setTextHookConfig(null)}
      >
        <X className="w-4 h-4" />
      </Button>
    </div>
    <Input
      value={textHookConfig.text}
      onChange={(e) => setTextHookConfig({ ...textHookConfig, text: e.target.value })}
      className="mb-2"
    />
    <div className="flex gap-2">
      {["white-box", "gradient", "outline", "minimal"].map((s) => (
        <Button
          key={s}
          variant={textHookConfig.style === s ? "default" : "outline"}
          size="sm"
          onClick={() => setTextHookConfig({ ...textHookConfig, style: s })}
        >
          {s}
        </Button>
      ))}
    </div>
  </div>
)}
```

---

## IMPLEMENTATION PRIORITY (6 hours)

### Hour 1-2: Script-Driven Editing UX
1. [x] Add cursor change on hover (5 min)
2. [ ] Add sticky help banner with shortcuts (15 min)
3. [ ] Add quick action buttons (20 min)
4. [ ] Add floating selection indicator (10 min)
5. [ ] Add first-time onboarding modal (20 min)

### Hour 3-4: Voice Cleanup
1. [ ] Create /api/enhance-audio route (30 min)
2. [ ] Add store setting for enhance toggle (10 min)
3. [ ] Add UI toggle in upload (10 min)
4. [ ] Test with sample videos (20 min)
5. [ ] Fallback: Dolby.io if FFmpeg fails (30 min)

### Hour 5: Text Hooks
1. [ ] Extend TextHookConfig interface (10 min)
2. [ ] Update TextHookOverlay with styles (20 min)
3. [ ] Wire through export pipeline (10 min)
4. [ ] Add text hook editor UI (15 min)

### Hour 6: Testing & Polish
1. [ ] End-to-end test all features
2. [ ] Fix any bugs
3. [ ] Prepare demo script
4. [ ] Record backup demo video

---

## FILES TO MODIFY

| File | Changes |
|------|---------|
| `src/features/editor/menu-item/transcript.tsx` | Add UX improvements (help banner, quick actions, onboarding) |
| `src/app/api/enhance-audio/route.ts` | NEW - Voice cleanup endpoint |
| `src/features/editor/store/use-upload-store.ts` | Add enhanceAudio setting |
| `src/features/editor/upload-landing.tsx` | Add enhance toggle |
| `src/features/editor/store/use-transcript-store.ts` | Extend TextHookConfig |
| `src/TranscriptVideo/index.tsx` | Update TextHookOverlay with styles |
| `src/features/editor/store/use-download-state.ts` | Pass textHookConfig to render |
| `src/app/api/render/route.ts` | Accept textHookConfig |

---

## SUCCESS CRITERIA

After implementation:
1. **Users immediately understand they can edit by clicking words** (no training needed)
2. **Audio sounds professional** (noise reduced, volume normalized)
3. **Exports have attention-grabbing text hooks** (configurable style)

These three features directly address:
- Judging criteria: "Voice cleanup (noise reduction, loudness leveling)"
- Judging criteria: "Adobe Premiere power with iPhone Notes simplicity"
- Competitive edge: Most polished, most intuitive editor in the room
