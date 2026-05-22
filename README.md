# Expound

Transcript-first video editor for talking-head content (Reels, TikTok, Shorts). Delete words in the transcript and the matching video is cut. Reorder clips in the transcript and the timeline follows.

Built in a few days for the [Stan Hackathon](https://github.com/AKN-7/hack-a-stan) (2nd place). The UI is built on top of [DesignCombo](https://github.com/designcombo/react-video-editor) editor packages.

## Features

- **Transcript-driven editing** — select words, press Delete, video cuts automatically
- **Multi-clip workflow** — upload, transcribe, reorder, and stitch clips
- **AI smart cuts** — `/api/analyze-cuts` suggests filler, false starts, and duplicate takes (Mercury via Inception Labs)
- **AI chat panel** — natural-language editing assistant in the sidebar
- **Real-time preview** — Remotion Player updates as you edit
- **Cloud export** — Remotion Lambda renders the final MP4 with captions
- **Optional extras** — audio enhancement (Cleanvoice), B-roll generation (Gemini), video generation (Gemini Veo / Runway)

## Tech stack

| Layer | Stack |
| --- | --- |
| App | Next.js 16, React 19, TypeScript |
| Video | Remotion 4.0.409 (player + Lambda render) |
| Transcription | Deepgram Nova-2 (word-level timestamps) |
| AI | Inception Mercury, Google Gemini |
| State | Zustand, React Query |
| Timeline UI | DesignCombo packages |
| Storage | AWS S3 + presigned URLs |

## Quick start

**New to the project?** Follow [SETUP-CHECKLIST.md](./SETUP-CHECKLIST.md) end to end before running locally.

```bash
git clone https://github.com/AKN-7/hack-a-stan.git expound
cd expound
pnpm install
cp env.example .env   # fill in your own keys — never commit .env
pnpm dev
```

Open [http://localhost:3000/edit](http://localhost:3000/edit).

### Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Start Next.js dev server |
| `pnpm build` | Production build |
| `pnpm start` | Run production server |
| `pnpm lint` | ESLint |
| `pnpm format` | Biome formatter |

## Environment variables

Copy `env.example` to `.env`. Minimum to run upload → transcribe → edit → export:

- `DEEPGRAM_API_KEY` — transcription
- `REMOTION_AWS_*` + `REMOTION_S3_BUCKET` — uploads and render storage
- `REMOTION_FUNCTION_NAME` + `REMOTION_SERVE_URL` — Lambda export
- `INCEPTION_API_KEY` — AI smart cuts (`/api/analyze-cuts`)

Optional:

- `GEMINI_API_KEY` — AI chat, B-roll, frame analysis
- `CLEANVOICE_API_KEY` — audio enhancement
- `RUNWAY_API_KEY` — video generation (falls back to Gemini Veo)
- `GROQ_API_KEY` — legacy; transcription uses Deepgram on `main`

See [env.example](./env.example) for the full list.

## Project layout

```
src/
├── app/
│   ├── api/              # transcribe, uploads, render, analyze-cuts, chat, …
│   └── edit/             # editor page
├── features/editor/      # transcript panel, timeline, player, stores
├── features/chat/        # AI chat assistant
├── CaptionedVideo/       # Remotion caption composition
├── TranscriptVideo/      # Remotion transcript-driven composition
└── remotion/             # Remotion entry
```

More detail: [HANDOFF.md](./HANDOFF.md).

## Branches

| Branch | Description |
| --- | --- |
| `main` | Stable hackathon editor (chat, TranscriptVideo composition) |
| `feat/project-document-editor` | WIP refactor: unified `ProjectComposition`, document EDL layer, org presets, chat removed |

## Deploying Remotion Lambda

After AWS credentials are in `.env`:

```bash
npx remotion lambda functions deploy
npx remotion lambda sites create src/remotion/index.ts --site-name=expound
```

Put the function name and serve URL into `.env`. See [SETUP-CHECKLIST.md](./SETUP-CHECKLIST.md) § Remotion Lambda.

## Notes

- **Remotion versions** — all `@remotion/*` packages are pinned to `4.0.409`. Do not mix versions.
- **`whisper.cpp` submodule** — vendored but unused; transcription goes through Deepgram. Safe to ignore or remove locally.
- **Sample media** — optional dev fixtures via `scripts/sync-sample-media.sh` (see script for paths).

## License

Private / source-available handoff. See terms agreed with the recipient before use or redistribution.
