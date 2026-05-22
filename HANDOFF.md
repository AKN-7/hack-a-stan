# Expound — project handoff

## What this is

A web app for editing talking-head videos where **the transcript is the editing interface**. Delete a sentence from the text and that part of the video is cut. Reorder sections and clips reorder on the timeline.

Most editors bolt on a transcript panel. Here the transcript is the source of truth; the video follows.

## Core flow

1. User uploads one or more video clips (S3 presigned upload)
2. Each clip is transcribed (Deepgram, word-level timestamps)
3. Transcript panel shows the full script with per-word timing
4. User edits text — delete filler, cut tangents, reorder clips
5. Remotion Player previews cuts in real time
6. Export triggers Remotion Lambda → MP4 download with captions

## What's working on `main`

| Feature | Status |
| --- | --- |
| Drag-and-drop upload → S3 | ✅ |
| Auto-transcription on upload | ✅ |
| Transcript panel (select, delete, reorder) | ✅ |
| Real-time Remotion preview | ✅ |
| Lambda export | ✅ (needs your AWS setup) |
| AI smart cuts (`/api/analyze-cuts`) | ✅ (needs `INCEPTION_API_KEY`) |
| AI chat sidebar | ✅ (needs `GEMINI_API_KEY`) |
| Audio enhancement (Cleanvoice) | ✅ optional |
| B-roll / video generation | ✅ optional |

## Tech stack

- **Next.js 16** (App Router)
- **Deepgram Nova-2** — transcription with word timestamps
- **Remotion 4.0.409** — preview + Lambda render
- **Inception Mercury** — smart-cut analysis
- **DesignCombo** — timeline / canvas UI packages
- **Zustand** — transcript, upload, and layout state

## Key files

### API routes (`src/app/api/`)

| Route | Purpose |
| --- | --- |
| `transcribe/` | Deepgram speech-to-text |
| `uploads/presign`, `uploads/url`, `uploads/` | S3 upload flow |
| `render/`, `render/[id]/` | Start and poll Lambda render |
| `analyze-cuts/` | AI suggested cuts (Mercury) |
| `chat/` | AI editing assistant |
| `enhance-audio/` | Cleanvoice noise/filler cleanup |
| `generate-broll/`, `generate-video/` | Optional generative media |

### Editor (`src/features/editor/`)

| Path | Purpose |
| --- | --- |
| `menu-item/transcript.tsx` | Transcript editing UI |
| `store/use-transcript-store.ts` | Clips, words, keep/cut segments |
| `store/use-upload-store.ts` | Upload queue + auto-transcribe |
| `player/composition.tsx` | Remotion preview wiring |
| `navbar.tsx` | Export flow |

### Remotion compositions

| Path | Purpose |
| --- | --- |
| `src/TranscriptVideo/` | Main export composition driven by transcript segments |
| `src/CaptionedVideo/` | Caption overlay composition |

### AI chat (`src/features/chat/`)

Chat store, Gemini service, and tool executor for natural-language edits.

## Data model (transcript store)

Each word:

```ts
{ id, text, startMs, endMs, clipId, confidence, isDeleted }
```

Editing flow:

1. User marks words deleted (soft delete, undo-friendly)
2. `getKeepSegments()` computes kept AV ranges
3. Preview composition and export both consume those segments

## Environment variables

See [env.example](./env.example). **Use your own keys and AWS resources** — do not reuse someone else's `.env`.

Setup walkthrough: [SETUP-CHECKLIST.md](./SETUP-CHECKLIST.md).

## WIP branch

`feat/project-document-editor` contains a larger refactor:

- Unified `ProjectComposition` replaces `CaptionedVideo` / `TranscriptVideo`
- New `src/core/document/` EDL layer with Vitest tests
- Org presets for agency-style export defaults
- Chat UI removed; several experimental routes quarantined

Use that branch if you want the newer architecture; use `main` for the hackathon-stable build.

## Known gotchas

1. **Remotion version lock** — keep all `@remotion/*` at `4.0.409`
2. **Presigned URLs** — S3 read URLs expire; production would need refresh or proxy
3. **`whisper.cpp` submodule** — present in repo but unused (Deepgram handles transcription)
4. **BoxParser console warnings** — harmless MP4 parse noise in dev tools

## Attribution

UI timeline/canvas built on [DesignCombo react-video-editor](https://github.com/designcombo/react-video-editor). Expound-specific transcript pipeline, AI cuts, and export logic are custom work on top.
