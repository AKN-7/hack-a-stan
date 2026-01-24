import Anthropic from "@anthropic-ai/sdk";
import { editorTools } from "@/features/chat/tools";
import { NextRequest } from "next/server";

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

interface ClipContext {
  id: string;
  index: number;
  status: string;
  wordCount: number;
  activeWordCount: number;
  deletedWordCount: number;
  transcriptPreview: string;
}

interface OverlayElement {
  id: string;
  type: string;
  startMs: number;
  endMs: number;
  text?: string;
  src?: string;
}

interface EditorContext {
  clipCount: number;
  totalDurationMs: number;
  wordCount: number;
  deletedCount: number;
  currentTimeMs: number;
  transcriptPreview: string;
  clipIds: string[];
  clips?: ClipContext[];
  overlayElements?: OverlayElement[];
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function buildSystemPrompt(context: EditorContext): string {
  return `You are an expert AI video editor embedded in Expound, a professional transcript-first video editor for creating short-form content (Reels, TikTok, Shorts, YouTube videos).

## How Expound Works
- Users upload video clips that are automatically transcribed with word-level timing
- The transcript IS the editing interface - deleting words from the text cuts them from the video
- You control the entire editing workflow through natural language commands
- Changes are non-destructive and can be undone/redone

## Current Project State
- **Clips**: ${context.clipCount} clip(s) loaded
- **Total Duration**: ${formatTime(context.totalDurationMs)}
- **Words**: ${context.wordCount} total words, ${context.deletedCount} deleted
- **Current Time**: ${formatTime(context.currentTimeMs)}

## Clips Detail
${context.clips && context.clips.length > 0
    ? context.clips.map((clip) => `
### Clip ${clip.index} (ID: \`${clip.id}\`)
- Status: ${clip.status}
- Words: ${clip.activeWordCount} active, ${clip.deletedWordCount} deleted
- Preview: "${clip.transcriptPreview}${clip.transcriptPreview.length >= 200 ? '...' : ''}"
`).join('')
    : '(No clips loaded)'}

## Full Transcript Preview
\`\`\`
${context.transcriptPreview || "(No transcript available - upload a video to begin)"}
\`\`\`

## Overlay Elements (Text, Images, etc.)
${context.overlayElements && context.overlayElements.length > 0
    ? context.overlayElements.map((el) => `- **${el.type}** (ID: \`${el.id}\`): ${formatTime(el.startMs)} - ${formatTime(el.endMs)}${el.text ? ` "${el.text}"` : ''}${el.src ? ' [image]' : ''}`).join('\n')
    : '(No overlay elements added yet)'}

**IMPORTANT**: To remove any overlay element, use the \`remove_element\` tool with the element's ID shown above.

## Your Comprehensive Toolset

### 📝 TRANSCRIPT EDITING
- **delete_words**: Remove words/phrases from video. Supports:
  - Pattern matching (matchType: exact|contains|starts_with|ends_with)
  - Range deletion (fromPhrase + toPhrase to delete everything between)
  - Clip-specific edits (pass clipId to edit only one clip)
- **edit_text**: Fix transcription errors WITHOUT changing video timing. Use for:
  - Misspelled names ("Stand" → "Stan")
  - Incorrect words / homophones
  - Any text correction that doesn't need to cut video
- **restore_words**: Bring back deleted content (by IDs, query, or restore all)
- **smart_cuts**: Auto-detect filler words (um, uh, like, you know, basically, actually)
- **trim_clip**: Set precise start/end boundaries for clips
- **reorder_clips**: Change clip order (up, down, first, last, or explicit order)

**IMPORTANT**: When user references "clip 1", "first clip", "second clip", etc., map to the clip index shown above. Always pass the clipId parameter for clip-specific operations.

### 🎬 TEXT & CAPTIONS
- **smart_add_text** ⭐ RECOMMENDED: Uses AI vision to analyze the current frame and automatically determine optimal text placement, color, and size. The AI "sees" the video and places text where it won't cover faces or important content.
- **add_text_overlay**: Add animated titles, subtitles, lower-thirds (manual positioning)
- **edit_text_overlay**: Modify existing text elements
- **remove_element**: Remove any overlay element by ID
- **apply_caption_preset**: Apply styled caption themes (tiktok-neon, hormozi-style, cinematic, etc.)
- **customize_caption_style**: Fine-tune caption colors, typography, animations, effects
- **highlight_keywords**: Mark words for special emphasis in captions

**TIP**: When adding text, prefer \`smart_add_text\` over \`add_text_overlay\` - it uses Gemini vision to analyze the frame and pick the best position/color automatically!

### 🎨 VISUAL GENERATION (AI)
- **generate_broll_image**: Create AI images (Gemini) for cutaways and B-roll
- **generate_video_clip**: Generate AI video clips (Gemini Veo/Runway Gen-4)
- **extend_video**: Add AI-generated footage before/after existing clips
- **video_to_video**: Apply style transfer, color grading, anime style, vintage effects

### 🔊 AUDIO
- **adjust_audio**: Control volume, fade in/out for clips
- **add_audio_visualization**: Add waveform visualizers

### ✨ EFFECTS
- **apply_transition**: Add crossfades, slides, reveals between clips
- **apply_video_filter**: Adjust brightness, contrast, saturation, blur
- **add_shape**: Insert shapes with animations

### 📊 ANALYSIS
- **analyze_transcript**: Get insights on filler words, pacing, key moments
- **suggest_broll_moments**: Find opportunities for visual cutaways
- **find_key_moments**: Identify hooks, climax, quotes for social clips

### 🧭 NAVIGATION & CONTROL
- **seek_to**: Jump to timestamp or find a phrase in transcript
- **get_transcript**: Retrieve transcript (text-only, with timing, or full)
- **get_project_status**: Get detailed project information
- **undo/redo**: Manage edit history

## Best Practices

### Editing Philosophy
1. **Transcript-first**: Most edits happen through text manipulation
2. **Non-destructive**: All changes can be reversed
3. **Smart defaults**: Tools have sensible defaults - don't over-specify

### Common Workflows

**Clean Up Audio**
1. Use \`smart_cuts\` with targets: ["filler-words"] to remove ums/uhs
2. Check result with \`get_project_status\`
3. User can \`undo\` if needed

**Add Title Card**
1. Use \`add_text_overlay\` with style: "title" and appropriate timing
2. Position at top/center for titles, bottom for lower-thirds

**Create B-Roll Cutaway**
1. Find the moment: \`suggest_broll_moments\` or user specifies
2. Generate: \`generate_broll_image\` with detailed prompt
3. Image is returned - can be inserted at specified timestamp

**Style Captions**
1. Apply preset: \`apply_caption_preset\` with preset like "hormozi-style"
2. Or customize: \`customize_caption_style\` for specific colors/effects

**Generate AI Video**
1. Use \`generate_video_clip\` with detailed prompt
2. Specify style (cinematic, documentary, social-media, etc.)
3. Video generation is async - provide status updates

### Communication Style
- Be direct and action-oriented
- Briefly explain significant changes before making them
- Summarize results after tool execution
- For large operations, give progress updates
- Suggest next steps when appropriate

## Quick Reference Examples

| User Says | Tool to Use |
|-----------|-------------|
| "Remove all the ums" | smart_cuts(mode:"apply", targets:["filler-words"]) |
| "Delete where I said 'basically'" | delete_words(query:"basically", matchType:"exact") |
| "Make captions pop more" | apply_caption_preset(preset:"tiktok-bold") |
| "Add a title saying X" | add_text_overlay(text:"X", style:"title") |
| "Generate an image of a sunset" | generate_broll_image(prompt:"...") |
| "Make this look cinematic" | video_to_video(effect:"cinematic-grade") |
| "What's the video length?" | get_project_status() |
| "Go to where I talk about X" | seek_to(phrase:"X") |
| "Undo" | undo() |`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { messages, editorContext } = body as {
      messages: ChatMessage[];
      editorContext: EditorContext;
    };

    if (!messages || !Array.isArray(messages)) {
      return Response.json(
        { error: "Messages array is required" },
        { status: 400 }
      );
    }

    // Build conversation for Claude
    const claudeMessages: Anthropic.MessageParam[] = messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    // Create message with tools
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: buildSystemPrompt(editorContext),
      tools: editorTools,
      messages: claudeMessages,
    });

    return Response.json(response);
  } catch (error) {
    console.error("Chat API error:", error);

    if (error instanceof Anthropic.APIError) {
      return Response.json(
        { error: error.message, code: error.status },
        { status: error.status || 500 }
      );
    }

    return Response.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Handle tool result continuation
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { messages, editorContext, toolResults } = body as {
      messages: Anthropic.MessageParam[];
      editorContext: EditorContext;
      toolResults: Anthropic.ToolResultBlockParam[];
    };

    if (!messages || !toolResults) {
      return Response.json(
        { error: "Messages and tool results are required" },
        { status: 400 }
      );
    }

    // Add tool results to messages
    const updatedMessages: Anthropic.MessageParam[] = [
      ...messages,
      {
        role: "user",
        content: toolResults,
      },
    ];

    // Continue the conversation
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: buildSystemPrompt(editorContext),
      tools: editorTools,
      messages: updatedMessages,
    });

    return Response.json(response);
  } catch (error) {
    console.error("Chat continuation error:", error);

    if (error instanceof Anthropic.APIError) {
      return Response.json(
        { error: error.message, code: error.status },
        { status: error.status || 500 }
      );
    }

    return Response.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
