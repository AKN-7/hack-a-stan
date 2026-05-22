# Expound setup checklist

Use this when spinning up the project on a new machine or handing the repo to someone else.

## 1. Clone and install

- [ ] Clone the repo and `cd` into it
- [ ] Install [Node.js 20+](https://nodejs.org/)
- [ ] Enable pnpm: `corepack enable` (or `npm i -g pnpm`)
- [ ] Run `pnpm install`
- [ ] Copy `env.example` → `.env` (keep `.env` out of git)

## 2. API keys (your accounts, not the original author's)

### Required for core editing

- [ ] **Deepgram** — [console.deepgram.com](https://console.deepgram.com/) → create API key → `DEEPGRAM_API_KEY`
- [ ] **Inception Labs** — Mercury for smart cuts → `INCEPTION_API_KEY`

### Required for upload + export

- [ ] **AWS IAM user** with S3 + Lambda permissions for Remotion
  - `REMOTION_AWS_ACCESS_KEY_ID`
  - `REMOTION_AWS_SECRET_ACCESS_KEY`
  - `REMOTION_AWS_REGION` (e.g. `us-east-1`)
  - `REMOTION_S3_BUCKET` (your bucket name)

### Optional features

- [ ] **Google AI / Gemini** — chat, B-roll, frame analysis → `GEMINI_API_KEY`
- [ ] **Cleanvoice** — audio enhancement → `CLEANVOICE_API_KEY`
- [ ] **Runway** — video generation → `RUNWAY_API_KEY` (otherwise Gemini Veo is used)

## 3. Remotion Lambda (cloud export)

Run from the project root with AWS creds in `.env`:

```bash
npx remotion lambda functions deploy
npx remotion lambda sites create src/remotion/index.ts --site-name=expound
```

- [ ] Copy the deployed **function name** → `REMOTION_FUNCTION_NAME`
- [ ] Copy the **serve URL** → `REMOTION_SERVE_URL`
- [ ] Confirm `REMOTION_S3_BUCKET` matches the bucket Remotion created/uses

Optional CORS fix for browser uploads (if needed):

```bash
node set-cors.mjs
```

## 4. Verify locally

- [ ] `pnpm dev`
- [ ] Open [http://localhost:3000/edit](http://localhost:3000/edit)
- [ ] Upload a short talking-head clip
- [ ] Confirm transcription completes (Transcript panel populates)
- [ ] Select words → Delete → preview updates
- [ ] Export → render progress → download MP4

## 5. Production build (optional sanity check)

- [ ] `pnpm build` completes without errors
- [ ] `pnpm start` serves the app

## 6. Before sharing or deploying further

- [ ] Never commit `.env` or paste real keys into docs/issues
- [ ] Rotate any keys that were ever shared in chat, screenshots, or old docs
- [ ] Agree on license / usage terms with the code owner if productizing
- [ ] Decide which branch to use:
  - **`main`** — hackathon-stable editor with AI chat
  - **`feat/project-document-editor`** — newer document pipeline refactor (WIP)

## Troubleshooting

| Symptom | Likely fix |
| --- | --- |
| Transcription fails | Check `DEEPGRAM_API_KEY`; confirm upload URL is reachable by Deepgram |
| Export stuck / 500 | Verify `REMOTION_FUNCTION_NAME`, `REMOTION_SERVE_URL`, AWS creds |
| "Multiple versions of Remotion" | Keep all `@remotion/*` at `4.0.409` |
| Upload CORS errors | Run `node set-cors.mjs` against your S3 bucket |
| Smart cuts 500 | Set `INCEPTION_API_KEY` |
| Chat / B-roll errors | Set `GEMINI_API_KEY` |
