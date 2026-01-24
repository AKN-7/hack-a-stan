⏺ Complete Codebase Understanding: Expound

  What is This Project?

  Expound is an innovative video editor for talking-head videos (Reels/TikTok/Shorts) where the transcript is the primary editing interface. The core innovation: delete a sentence from the transcript, and that part of the video gets cut automatically. Reorder paragraphs, and video clips reorder accordingly.

  ---
  Tech Stack
  ┌───────────────┬────────────────────────────────────────────────────────┐
  │     Layer     │                      Technologies                      │
  ├───────────────┼────────────────────────────────────────────────────────┤
  │ Framework     │ Next.js 15 (App Router), React 19, TypeScript 5        │
  ├───────────────┼────────────────────────────────────────────────────────┤
  │ Video         │ Remotion 4.0.409 (player, lambda rendering, captions)  │
  ├───────────────┼────────────────────────────────────────────────────────┤
  │ Transcription │ Deepgram SDK (Nova-2 model with word-level timestamps) │
  ├───────────────┼────────────────────────────────────────────────────────┤
  │ State         │ Zustand 5 (persisted stores), React Query 5            │
  ├───────────────┼────────────────────────────────────────────────────────┤
  │ Timeline      │ DesignCombo packages (timeline, state, transitions)    │
  ├───────────────┼────────────────────────────────────────────────────────┤
  │ Cloud         │ AWS S3 (storage), AWS Lambda (video rendering)         │
  ├───────────────┼────────────────────────────────────────────────────────┤
  │ UI            │ Tailwind CSS 4, Radix UI, Framer Motion                │
  └───────────────┴────────────────────────────────────────────────────────┘
  ---
  Directory Structure

  src/
  ├── app/                    # Next.js App Router
  │   ├── api/
  │   │   ├── transcribe/     # Deepgram speech-to-text
  │   │   ├── uploads/        # S3 presigned URLs & file upload
  │   │   └── render/         # Remotion Lambda rendering
  │   └── edit/               # Main editor page
  ├── features/editor/        # Main editor (~336 files)
  │   ├── player/             # Remotion player & compositions
  │   ├── timeline/           # Timeline UI components
  │   ├── menu-item/          # Sidebar panels (transcript, uploads, etc.)
  │   ├── store/              # Zustand stores (transcript, upload, layout)
  │   └── scene/              # Canvas/preview area
  ├── components/ui/          # Radix UI wrappers
  ├── TranscriptVideo/        # Transcript-driven rendering (KEY)
  └── utils/                  # Upload service, helpers

  ---
  Core Features

  1. Upload System - Drag-and-drop video upload to AWS S3 with presigned URLs, auto-triggers transcription
  2. Transcription - Deepgram Nova-2 provides word-level timestamps with confidence scores
  { id, text, startMs, endMs, clipId, confidence, isDeleted }
  3. Transcript-Driven Editing (the innovation):
    - Delete words → video segments cut automatically
    - getKeepSegments() calculates which parts to keep
    - getRenderSegments() builds timeline for final render
  4. Smart Cuts - Auto-detects filler words (um, uh, like, you know) for suggested removal
  5. Real-time Preview - Remotion Player shows edits instantly with word highlighting
  6. Export - Remotion Lambda renders final MP4 in the cloud

  ---
  Data Flow

  Upload video → S3 storage → Deepgram transcription → Word-level transcript
       ↓
  User edits transcript (deletes words)
       ↓
  Store recalculates keep/cut segments → Composition updates
       ↓
  Preview shows edited video → Export triggers Lambda render → MP4 download

  ---
  Key Stores (src/features/editor/store/)
  ┌─────────────────────────┬────────────────────────────────────────────┐
  │          Store          │                  Purpose                   │
  ├─────────────────────────┼────────────────────────────────────────────┤
  │ use-transcript-store.ts │ Critical - Clips, words, keep/cut segments │
  ├─────────────────────────┼────────────────────────────────────────────┤
  │ use-upload-store.ts     │ Upload queue, progress, auto-transcription │
  ├─────────────────────────┼────────────────────────────────────────────┤
  │ use-store.ts            │ Timeline state, player ref, tracks         │
  ├─────────────────────────┼────────────────────────────────────────────┤
  │ use-layout-store.ts     │ UI panel states                            │
  └─────────────────────────┴────────────────────────────────────────────┘
  ---
  External Integrations

  - Deepgram - Speech-to-text API (Nova-2 model)
  - AWS S3 - Video storage with 7-day presigned URLs
  - Remotion Lambda - Serverless video rendering (us-east-1)

  ---
  Current State (from git status)

  Recent work has been on stabilizing transcription. Modified files include:
  - TranscriptVideo/index.tsx
  - api/transcribe/route.ts
  - menu-item/transcript.tsx
  - player/composition.tsx, player.tsx, transcript-composition.tsx
  - use-transcript-store.ts, use-upload-store.ts

  The extract-audio.ts utility was deleted (Deepgram handles audio directly).

  ---
  Architecture Highlights

  - Soft deletes - Words have isDeleted flag for undo support
  - Smart gap detection - 500ms tolerance groups words into segments
  - Persistence - Zustand stores persist to localStorage
  - Version pinning - All Remotion packages at 4.0.409 to avoid conflicts

  This is a well-architected, modern video editing application with a unique transcript-first approach to video editing.
