# Expound - Hackathon Project Handoff

## What We're Building

A web app for editing talking-head videos (Reels/TikTok/Shorts) where **the transcript IS the editing interface**. Delete a sentence from the text, that part of the video gets cut. Reorder paragraphs, the clips reorder.

### The Core Flow
1. User drags in 3-5 video clips
2. App uploads them to S3
3. Each clip gets sent to Whisper (via Groq) for transcription with word-level timestamps
4. App auto-stitches clips and merges transcripts into one unified script
5. User sees split view: transcript on left, video preview on right
6. User edits transcript — delete filler words, remove tangents, reorder sections
7. Every text edit maps back to video (each word has timestamp tied to specific clip)
8. Remotion Player shows preview in real-time
9. User clicks Export, Remotion Lambda renders final MP4 with captions
10. User downloads finished video

### Key Differentiator
Most video editors bolt on a transcript panel. We're inverting it — the transcript IS the source of truth, the video just follows.

---

## Tech Stack

- **Next.js 15** (App Router) — web framework
- **AWS S3** — stores uploaded clips (same bucket as Remotion Lambda)
- **Groq Whisper API** — transcribes with word-level timestamps
- **Remotion** — composes video programmatically in React
- **Remotion Player** — previews composition in browser
- **Remotion Lambda** — renders final MP4 in cloud (already deployed)
- **DesignCombo packages** — timeline UI (@designcombo/timeline, @designcombo/state)

---

## What's Working

| Feature | Status |
|---------|--------|
| Upload video via drag & drop | ✅ Working |
| Upload to S3 with presigned URLs | ✅ Working |
| Video appears in uploads panel | ✅ Working |
| Add video to timeline | ✅ Working |
| Video playback in preview | ✅ Working |
| Transcription API endpoint | ✅ Exists (not wired to upload flow) |
| Render API endpoint | ✅ Exists |

---

## What Needs to Be Built

### 1. Auto-transcribe on Upload
When a video is uploaded, automatically call `/api/transcribe` and store the result.

### 2. Transcript Panel UI
- Left panel showing the full transcript
- Each word is a span with `data-clip-id`, `data-start-ms`, `data-end-ms`
- Editable (contenteditable or controlled input)

### 3. Sync Layer (Text Edit → Video)
- Delete word/sentence → filter those timestamps from composition
- Reorder paragraphs → reorder video segments
- This is the core innovation

### 4. Smart Cuts (Nice to Have)
- Auto-detect and remove "um", "uh", long pauses, false starts
- Detect gaps > 300-500ms between words and auto-trim silence

---

## Key Files

### API Routes
- `src/app/api/uploads/route.ts` — Uploads files to S3, returns presigned URL
- `src/app/api/transcribe/route.ts` — Groq Whisper transcription
- `src/app/api/render/route.ts` — Remotion Lambda rendering

### Editor Components
- `src/features/editor/` — Main editor UI
- `src/features/editor/menu-item/uploads.tsx` — Upload panel, handles adding videos to timeline
- `src/features/editor/player/` — Remotion player components
- `src/features/editor/player/items/video.tsx` — Video item renderer

### State Management
- `src/features/editor/store/use-upload-store.ts` — Upload state (zustand)
- Uses `@designcombo/state` and `@designcombo/events` for timeline state

### Remotion Compositions
- `src/CaptionedVideo/` — Original captioned video composition (from backup)
- `src/remotion/` — Remotion entry points

---

## Environment Variables

```env
# AWS (Remotion Lambda uses same credentials)
REMOTION_AWS_ACCESS_KEY_ID=
REMOTION_AWS_SECRET_ACCESS_KEY=
REMOTION_AWS_REGION=us-east-1
REMOTION_S3_BUCKET=remotionlambda-useast1-dieejrl3lf

# Remotion Lambda
REMOTION_FUNCTION_NAME=
REMOTION_SERVE_URL=

# Groq (for Whisper transcription)
GROQ_API_KEY=
```

---

## Transcription Response Format

The `/api/transcribe` endpoint returns:

```json
{
  "text": "Full transcript text...",
  "captions": [
    {
      "text": "So",
      "startMs": 12400,
      "endMs": 12600,
      "timestampMs": 12400,
      "confidence": 1
    },
    {
      "text": "today",
      "startMs": 12600,
      "endMs": 12900,
      "timestampMs": 12600,
      "confidence": 1
    }
    // ... more words
  ],
  "segments": [
    { "start": 12.4, "end": 15.2, "text": "So today we're gonna talk about..." }
  ]
}
```

---

## Smart Cuts Logic (For Reference)

To auto-remove silence and filler words:

```typescript
// Detect speech segments from word timestamps
function detectSpeechSegments(words, options = { maxGapMs: 300, paddingMs: 100 }) {
  const segments = [];
  let currentSegment = null;

  for (const word of words) {
    // Skip filler words
    if (/^(um|uh|like|you know|basically)$/i.test(word.text.trim())) {
      continue;
    }

    if (!currentSegment) {
      currentSegment = { start: word.startMs - options.paddingMs, end: word.endMs + options.paddingMs };
    } else if (word.startMs - currentSegment.end > options.maxGapMs) {
      // Gap too large, start new segment
      segments.push(currentSegment);
      currentSegment = { start: word.startMs - options.paddingMs, end: word.endMs + options.paddingMs };
    } else {
      // Extend current segment
      currentSegment.end = word.endMs + options.paddingMs;
    }
  }

  if (currentSegment) segments.push(currentSegment);
  return segments;
}
```

---

## Running the Project

```bash
cd /Users/ameenneami/Development/Hackathons/expound
npm run dev
# Opens at http://localhost:3000/edit (or 3002 if 3000 is taken)
```

---

## Known Issues / Gotchas

1. **BoxParser warnings in console** — Ignore these. They're just MP4 parsing noise, doesn't affect functionality.

2. **Remotion version** — All packages pinned to 4.0.409. Don't mix versions or you'll get "Multiple versions of Remotion detected" error.

3. **S3 presigned URLs** — URLs expire in 7 days. For production, would need to refresh them or use a proxy.

4. **DesignCombo timeline** — Has some initialization bugs (`calcBounding` error). May want to bypass their timeline entirely and build a simpler transcript-based UI.

---

## The Vision

User uploads raw footage of themselves talking. App:
1. Auto-transcribes everything
2. Auto-removes dead air (silence where they're just staring)
3. Auto-removes filler words (um, uh, like)
4. Shows them a clean transcript they can edit
5. Every edit to the text = edit to the video
6. Export polished video with captions baked in

**This turns a 25-second rambling clip into a tight 8-second video automatically.**
