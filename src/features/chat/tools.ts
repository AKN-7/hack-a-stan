import type { Tool } from "@anthropic-ai/sdk/resources/messages";

/**
 * Comprehensive tool definitions for AI-powered video editing
 * Maps to transcript store, DesignCombo, and external generation APIs
 */

// ============================================================================
// TRANSCRIPT EDITING TOOLS
// ============================================================================

const transcriptTools: Tool[] = [
  {
    name: "delete_words",
    description:
      "Delete specific words or phrases from the video transcript. This removes the corresponding portions from the video. Use this when the user wants to cut filler words, remove specific phrases, or clean up their transcript. The words are soft-deleted and can be restored later. Supports range deletion to remove everything between two phrases.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description:
            "Text pattern to delete. Can be an exact word/phrase (e.g., 'um', 'you know') or pattern. Case-insensitive. Not needed if using range deletion with fromPhrase/toPhrase.",
        },
        clipId: {
          type: "string",
          description: "Optional clip ID to limit deletion to a specific clip.",
        },
        matchType: {
          type: "string",
          enum: ["exact", "contains", "starts_with", "ends_with"],
          description: "How to match the query. Default is 'contains'.",
        },
        fromPhrase: {
          type: "string",
          description: "Start phrase for range deletion. Deletes all words from this phrase up to (and including) toPhrase. Use with toPhrase for range deletion.",
        },
        toPhrase: {
          type: "string",
          description: "End phrase for range deletion. Deletes all words from fromPhrase up to (and including) this phrase.",
        },
        includeBoundaries: {
          type: "boolean",
          description: "Whether to include the fromPhrase and toPhrase in the deletion. Default is true.",
        },
      },
      required: [],
    },
  },
  {
    name: "restore_words",
    description:
      "Restore previously deleted words back to the video. Use when the user wants to undo deletions.",
    input_schema: {
      type: "object" as const,
      properties: {
        wordIds: {
          type: "array",
          items: { type: "string" },
          description: "Specific word IDs to restore",
        },
        restoreAll: {
          type: "boolean",
          description: "If true, restores all deleted words in the project",
        },
        query: {
          type: "string",
          description: "Restore words matching this text pattern",
        },
      },
    },
  },
  {
    name: "edit_text",
    description:
      "Edit/correct text in the transcript without changing the video timing. Use this to fix transcription errors like misspelled names, incorrect words, or homophones. The video stays exactly the same - only the displayed transcript and captions text changes.",
    input_schema: {
      type: "object" as const,
      properties: {
        find: {
          type: "string",
          description: "The word/text to find and replace. Case-insensitive by default.",
        },
        replace: {
          type: "string",
          description: "The corrected text to replace it with.",
        },
        matchCase: {
          type: "boolean",
          description: "If true, match case exactly. Default is false (case-insensitive).",
        },
        clipId: {
          type: "string",
          description: "Optional clip ID to limit the edit to a specific clip.",
        },
      },
      required: ["find", "replace"],
    },
  },
  {
    name: "smart_cuts",
    description:
      "Automatically detect and optionally remove filler words (um, uh, like, you know, basically, actually, so, right, okay, yeah) from the transcript. Use 'suggest' mode to preview, 'apply' to immediately remove.",
    input_schema: {
      type: "object" as const,
      properties: {
        mode: {
          type: "string",
          enum: ["suggest", "apply", "review"],
          description:
            "'suggest' marks for review, 'apply' immediately deletes, 'review' shows what's currently suggested.",
        },
        targets: {
          type: "array",
          items: {
            type: "string",
            enum: ["filler-words", "long-pauses", "repeated-phrases", "sentence-starters"],
          },
          description: "Types of content to target.",
        },
        sensitivity: {
          type: "string",
          enum: ["low", "medium", "high"],
          description: "How aggressive the detection should be. Default is 'medium'.",
        },
      },
      required: ["mode", "targets"],
    },
  },
  {
    name: "reorder_clips",
    description: "Reorder video clips in the timeline. Changes the sequence of clips in the final video.",
    input_schema: {
      type: "object" as const,
      properties: {
        clipId: {
          type: "string",
          description: "The clip to move",
        },
        direction: {
          type: "string",
          enum: ["up", "down", "first", "last"],
          description: "Direction to move the clip",
        },
        newOrder: {
          type: "array",
          items: { type: "string" },
          description: "Alternatively, provide explicit new order of all clip IDs",
        },
      },
    },
  },
  {
    name: "trim_clip",
    description: "Trim the start or end of a clip by setting trim boundaries in milliseconds.",
    input_schema: {
      type: "object" as const,
      properties: {
        clipId: {
          type: "string",
          description: "The clip to trim",
        },
        startMs: {
          type: "number",
          description: "New start position in milliseconds (relative to clip start)",
        },
        endMs: {
          type: "number",
          description: "New end position in milliseconds",
        },
      },
      required: ["clipId"],
    },
  },
  {
    name: "get_transcript",
    description:
      "Get the current transcript content with word-level data, timing, and clip information.",
    input_schema: {
      type: "object" as const,
      properties: {
        includeDeleted: {
          type: "boolean",
          description: "If true, includes deleted words in response",
        },
        clipId: {
          type: "string",
          description: "Get transcript for specific clip only",
        },
        format: {
          type: "string",
          enum: ["full", "text-only", "words-with-timing"],
          description: "Output format. Default is 'full'.",
        },
      },
    },
  },
  {
    name: "get_project_status",
    description:
      "Get comprehensive project status: clip count, duration, word stats, editing progress, render segments.",
    input_schema: {
      type: "object" as const,
      properties: {
        detailed: {
          type: "boolean",
          description: "Include detailed per-clip breakdown",
        },
      },
    },
  },
  {
    name: "undo",
    description: "Undo the last editing action.",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "redo",
    description: "Redo a previously undone action.",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
];

// ============================================================================
// NAVIGATION & PLAYBACK TOOLS
// ============================================================================

const navigationTools: Tool[] = [
  {
    name: "seek_to",
    description: "Seek the video player to a specific time or phrase in the transcript.",
    input_schema: {
      type: "object" as const,
      properties: {
        timeMs: {
          type: "number",
          description: "Time in milliseconds to seek to",
        },
        phrase: {
          type: "string",
          description: "Text phrase to find and seek to (first occurrence)",
        },
        position: {
          type: "string",
          enum: ["start", "end", "middle"],
          description: "Where in the phrase to seek. Default is 'start'.",
        },
      },
    },
  },
  {
    name: "set_playback_rate",
    description: "Change the video playback speed.",
    input_schema: {
      type: "object" as const,
      properties: {
        rate: {
          type: "number",
          description: "Playback rate (0.5 = half speed, 1 = normal, 2 = double speed)",
        },
      },
      required: ["rate"],
    },
  },
];

// ============================================================================
// TEXT OVERLAY TOOLS
// ============================================================================

const textOverlayTools: Tool[] = [
  {
    name: "add_text_overlay",
    description:
      "Add an animated text overlay (title, subtitle, lower-third, callout) to the video. Supports multiple animation presets and styling options.",
    input_schema: {
      type: "object" as const,
      properties: {
        text: {
          type: "string",
          description: "The text content to display",
        },
        style: {
          type: "string",
          enum: ["title", "subtitle", "lower-third", "callout", "quote", "heading", "body"],
          description: "Pre-configured style preset",
        },
        startMs: {
          type: "number",
          description: "When the text should appear (milliseconds from start)",
        },
        durationMs: {
          type: "number",
          description: "How long the text stays visible (default: 3000ms)",
        },
        position: {
          type: "object",
          properties: {
            horizontal: { type: "string", enum: ["left", "center", "right"] },
            vertical: { type: "string", enum: ["top", "middle", "bottom"] },
          },
          description: "Position on screen",
        },
        animation: {
          type: "object",
          properties: {
            in: {
              type: "string",
              enum: [
                "fadeIn", "scaleIn", "slideInLeft", "slideInRight", "slideInTop", "slideInBottom",
                "typewriter", "rotateIn", "flipIn", "dropIn", "popIn", "bounceIn"
              ],
            },
            out: {
              type: "string",
              enum: [
                "fadeOut", "scaleOut", "slideOutLeft", "slideOutRight", "slideOutTop", "slideOutBottom",
                "typewriter", "rotateOut", "flipOut", "dropOut"
              ],
            },
            loop: {
              type: "string",
              enum: [
                "none", "pulse", "shake", "glow", "spin", "bounce", "wave", "heartbeat", "glitch"
              ],
            },
          },
          description: "Animation effects",
        },
        styling: {
          type: "object",
          properties: {
            fontFamily: { type: "string" },
            fontSize: { type: "number" },
            fontWeight: { type: "string", enum: ["normal", "bold", "light"] },
            color: { type: "string", description: "Hex color code" },
            backgroundColor: { type: "string" },
            textShadow: { type: "boolean" },
            textStroke: { type: "boolean" },
            textTransform: { type: "string", enum: ["none", "uppercase", "lowercase", "capitalize"] },
          },
          description: "Custom styling overrides",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "edit_text_overlay",
    description: "Modify an existing text overlay's content, timing, or styling.",
    input_schema: {
      type: "object" as const,
      properties: {
        elementId: {
          type: "string",
          description: "ID of the text element to edit",
        },
        updates: {
          type: "object",
          properties: {
            text: { type: "string" },
            startMs: { type: "number" },
            durationMs: { type: "number" },
            color: { type: "string" },
            fontSize: { type: "number" },
            animation: { type: "string" },
          },
          description: "Properties to update",
        },
      },
      required: ["elementId", "updates"],
    },
  },
  {
    name: "remove_element",
    description: "Remove a text overlay, image, or other element from the timeline.",
    input_schema: {
      type: "object" as const,
      properties: {
        elementId: {
          type: "string",
          description: "ID of the element to remove",
        },
      },
      required: ["elementId"],
    },
  },
  {
    name: "smart_add_text",
    description:
      "Use AI vision to intelligently add text to the video. Analyzes the current frame to determine optimal position, color, and styling that won't cover important content and will be readable. RECOMMENDED over add_text_overlay when you want professional-looking results.",
    input_schema: {
      type: "object" as const,
      properties: {
        text: {
          type: "string",
          description: "The text content to display",
        },
        style: {
          type: "string",
          enum: ["title", "subtitle", "lower-third", "callout", "quote"],
          description: "General style hint for the AI (default: title)",
        },
        startMs: {
          type: "number",
          description: "When the text should appear (milliseconds). If not provided, uses current playhead position.",
        },
        durationMs: {
          type: "number",
          description: "How long the text stays visible (default: 3000ms)",
        },
      },
      required: ["text"],
    },
  },
];

// ============================================================================
// CAPTION STYLING TOOLS
// ============================================================================

const captionTools: Tool[] = [
  {
    name: "apply_caption_preset",
    description:
      "Apply a pre-designed caption style preset. Includes TikTok-style, karaoke, cinematic, and more.",
    input_schema: {
      type: "object" as const,
      properties: {
        preset: {
          type: "string",
          enum: [
            "tiktok-neon", "tiktok-bold", "karaoke-green", "karaoke-blue",
            "cinematic-white", "cinematic-gold", "minimal-clean", "bold-outline",
            "gradient-pop", "typewriter-retro", "hormozi-style", "beasty-style",
            "ella-style", "underline-pop", "shadow-glow"
          ],
          description: "Caption style preset name",
        },
      },
      required: ["preset"],
    },
  },
  {
    name: "customize_caption_style",
    description:
      "Customize caption appearance with granular control over colors, fonts, animations, and effects.",
    input_schema: {
      type: "object" as const,
      properties: {
        colors: {
          type: "object",
          properties: {
            activeColor: { type: "string", description: "Color of word being spoken (hex)" },
            appearedColor: { type: "string", description: "Color of words already spoken" },
            baseColor: { type: "string", description: "Color of upcoming words" },
            activeFillColor: { type: "string", description: "Background/highlight of active word" },
            keywordColor: { type: "string", description: "Special color for emphasized words" },
          },
        },
        typography: {
          type: "object",
          properties: {
            fontFamily: { type: "string" },
            fontSize: { type: "number" },
            fontWeight: { type: "string" },
            textTransform: { type: "string", enum: ["none", "uppercase", "lowercase"] },
            letterSpacing: { type: "number" },
          },
        },
        effects: {
          type: "object",
          properties: {
            textStroke: { type: "boolean" },
            strokeWidth: { type: "number" },
            strokeColor: { type: "string" },
            textShadow: { type: "boolean" },
            shadowColor: { type: "string" },
            shadowBlur: { type: "number" },
          },
        },
        animation: {
          type: "string",
          enum: [
            "none", "scale-pop", "scale-pulse", "fade-in", "slide-up", "slide-down",
            "typewriter", "bounce", "wave", "rotate-random", "translate-bilateral",
            "hormozi", "beasty", "ella"
          ],
          description: "Word-by-word animation effect",
        },
        layout: {
          type: "object",
          properties: {
            position: { type: "string", enum: ["top", "middle", "bottom"] },
            alignment: { type: "string", enum: ["left", "center", "right"] },
            linesPerCaption: { type: "number", description: "1-5 lines per caption block" },
            wordsPerLine: { type: "string", enum: ["auto", "single", "punctuation"] },
          },
        },
      },
    },
  },
  {
    name: "highlight_keywords",
    description:
      "Mark specific words as keywords for special emphasis (different color, animation, or styling).",
    input_schema: {
      type: "object" as const,
      properties: {
        keywords: {
          type: "array",
          items: { type: "string" },
          description: "Words to highlight as keywords",
        },
        style: {
          type: "object",
          properties: {
            color: { type: "string" },
            scale: { type: "number" },
            animation: { type: "string" },
          },
          description: "Styling for highlighted keywords",
        },
      },
      required: ["keywords"],
    },
  },
];

// ============================================================================
// ASSET GENERATION TOOLS
// ============================================================================

const generationTools: Tool[] = [
  {
    name: "generate_broll_image",
    description:
      "Generate a B-roll image using AI (Gemini). Creates visual assets that can be inserted as cutaways.",
    input_schema: {
      type: "object" as const,
      properties: {
        prompt: {
          type: "string",
          description: "Detailed description of image to generate. Be specific about subject, style, mood.",
        },
        style: {
          type: "string",
          enum: ["photorealistic", "illustration", "cinematic", "minimalist", "abstract", "3d-render", "anime"],
          description: "Visual style for the generated image",
        },
        aspectRatio: {
          type: "string",
          enum: ["9:16", "16:9", "1:1", "4:5"],
          description: "Aspect ratio. Default is 9:16 for vertical video.",
        },
        insertAt: {
          type: "number",
          description: "Optional: Insert as B-roll at this timestamp (milliseconds)",
        },
        durationMs: {
          type: "number",
          description: "How long to show the B-roll (default: 3000ms)",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "generate_video_clip",
    description:
      "Generate a short video clip using AI (Runway or Gemini Veo). Creates dynamic B-roll footage.",
    input_schema: {
      type: "object" as const,
      properties: {
        prompt: {
          type: "string",
          description: "Detailed description of video to generate. Include motion, camera movement, mood.",
        },
        style: {
          type: "string",
          enum: ["cinematic", "documentary", "commercial", "social-media", "artistic", "realistic"],
          description: "Video style preset",
        },
        duration: {
          type: "number",
          enum: [4, 6, 8],
          description: "Video duration in seconds (4, 6, or 8)",
        },
        aspectRatio: {
          type: "string",
          enum: ["9:16", "16:9", "1:1"],
          description: "Video aspect ratio",
        },
        referenceImage: {
          type: "string",
          description: "Optional URL of reference image to guide the video style",
        },
        withAudio: {
          type: "boolean",
          description: "Generate synchronized audio (Veo only)",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "extend_video",
    description:
      "Extend an existing video clip using AI generation (adds more footage in the same style).",
    input_schema: {
      type: "object" as const,
      properties: {
        clipId: {
          type: "string",
          description: "ID of the clip to extend",
        },
        direction: {
          type: "string",
          enum: ["before", "after"],
          description: "Whether to extend before or after the clip",
        },
        durationSeconds: {
          type: "number",
          description: "How many seconds to add (4-8)",
        },
        prompt: {
          type: "string",
          description: "Optional prompt to guide the extension",
        },
      },
      required: ["clipId", "direction"],
    },
  },
  {
    name: "video_to_video",
    description:
      "Apply AI-powered style transfer or effects to an existing video segment.",
    input_schema: {
      type: "object" as const,
      properties: {
        clipId: {
          type: "string",
          description: "ID of the clip to transform",
        },
        effect: {
          type: "string",
          enum: [
            "style-transfer", "enhance", "slow-motion", "color-grade",
            "anime-style", "cartoon-style", "cinematic-grade", "vintage"
          ],
          description: "Effect to apply",
        },
        prompt: {
          type: "string",
          description: "For style-transfer: describe the desired style",
        },
        intensity: {
          type: "number",
          description: "Effect intensity 0-1 (default: 0.7)",
        },
      },
      required: ["clipId", "effect"],
    },
  },
];

// ============================================================================
// AUDIO & VISUALIZATION TOOLS
// ============================================================================

const audioTools: Tool[] = [
  {
    name: "add_audio_visualization",
    description: "Add an audio visualization element (waveform bars, wave, hill, radial) that reacts to audio.",
    input_schema: {
      type: "object" as const,
      properties: {
        type: {
          type: "string",
          enum: ["linear-bars", "wave", "hill", "radial"],
          description: "Visualization type",
        },
        style: {
          type: "object",
          properties: {
            color: { type: "string", description: "Bar/wave color (hex)" },
            thickness: { type: "number", description: "Line/bar thickness in pixels" },
            gap: { type: "number", description: "Gap between bars" },
            roundness: { type: "number", description: "Border radius of bars" },
            height: { type: "number", description: "Max height of visualization" },
          },
        },
        position: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
          },
        },
        startMs: { type: "number" },
        durationMs: { type: "number" },
      },
      required: ["type"],
    },
  },
  {
    name: "adjust_audio",
    description: "Adjust audio properties for a clip (volume, fade in/out).",
    input_schema: {
      type: "object" as const,
      properties: {
        clipId: {
          type: "string",
          description: "ID of the clip to adjust",
        },
        volume: {
          type: "number",
          description: "Volume level 0-1 (1 = 100%)",
        },
        fadeInMs: {
          type: "number",
          description: "Fade in duration in milliseconds",
        },
        fadeOutMs: {
          type: "number",
          description: "Fade out duration in milliseconds",
        },
      },
      required: ["clipId"],
    },
  },
];

// ============================================================================
// VISUAL EFFECTS TOOLS
// ============================================================================

const effectsTools: Tool[] = [
  {
    name: "apply_transition",
    description: "Apply a transition effect between two clips or at a cut point.",
    input_schema: {
      type: "object" as const,
      properties: {
        type: {
          type: "string",
          enum: [
            "crossfade", "slide-left", "slide-right", "slide-up", "slide-down",
            "circle-reveal", "rectangle-wipe", "star-burst", "sliding-doors", "zoom"
          ],
          description: "Transition type",
        },
        atMs: {
          type: "number",
          description: "Timestamp where transition occurs (at a cut point)",
        },
        durationMs: {
          type: "number",
          description: "Transition duration (default: 500ms)",
        },
      },
      required: ["type"],
    },
  },
  {
    name: "apply_video_filter",
    description: "Apply visual filters to a video clip (brightness, blur, color grade).",
    input_schema: {
      type: "object" as const,
      properties: {
        clipId: {
          type: "string",
          description: "ID of the clip (optional - applies to all if not specified)",
        },
        filters: {
          type: "object",
          properties: {
            brightness: { type: "number", description: "Brightness adjustment 0-2 (1 = normal)" },
            contrast: { type: "number", description: "Contrast adjustment 0-2" },
            saturation: { type: "number", description: "Saturation adjustment 0-2" },
            blur: { type: "number", description: "Blur amount in pixels" },
            vignette: { type: "number", description: "Vignette intensity 0-1" },
          },
        },
      },
      required: ["filters"],
    },
  },
  {
    name: "add_shape",
    description: "Add a shape element (rectangle, circle, arrow, line) with optional animation.",
    input_schema: {
      type: "object" as const,
      properties: {
        shape: {
          type: "string",
          enum: ["rectangle", "circle", "ellipse", "arrow", "line", "star", "triangle"],
          description: "Shape type",
        },
        position: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
          },
        },
        size: {
          type: "object",
          properties: {
            width: { type: "number" },
            height: { type: "number" },
          },
        },
        style: {
          type: "object",
          properties: {
            fillColor: { type: "string" },
            strokeColor: { type: "string" },
            strokeWidth: { type: "number" },
            opacity: { type: "number" },
          },
        },
        startMs: { type: "number" },
        durationMs: { type: "number" },
        animation: {
          type: "string",
          enum: ["none", "fadeIn", "scaleIn", "drawIn", "popIn"],
        },
      },
      required: ["shape"],
    },
  },
];

// ============================================================================
// ANALYSIS & SUGGESTION TOOLS
// ============================================================================

const analysisTools: Tool[] = [
  {
    name: "analyze_transcript",
    description:
      "Analyze the transcript content for improvement opportunities (filler words, pacing, structure).",
    input_schema: {
      type: "object" as const,
      properties: {
        analysisType: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "filler-words", "pacing", "structure", "key-moments",
              "broll-opportunities", "caption-suggestions", "cut-points"
            ],
          },
          description: "Types of analysis to perform",
        },
      },
      required: ["analysisType"],
    },
  },
  {
    name: "suggest_broll_moments",
    description:
      "Analyze transcript and suggest where B-roll would enhance the video, with image/video prompts.",
    input_schema: {
      type: "object" as const,
      properties: {
        maxSuggestions: {
          type: "number",
          description: "Maximum number of suggestions (default: 5)",
        },
        style: {
          type: "string",
          enum: ["any", "images-only", "videos-only"],
          description: "Type of B-roll to suggest",
        },
      },
    },
  },
  {
    name: "find_key_moments",
    description:
      "Identify key moments in the video (hooks, climax, important quotes) for highlights or clips.",
    input_schema: {
      type: "object" as const,
      properties: {
        purpose: {
          type: "string",
          enum: ["social-clips", "highlights", "chapters", "quotes"],
          description: "What the key moments will be used for",
        },
        maxMoments: {
          type: "number",
          description: "Maximum number of moments to find (default: 5)",
        },
      },
    },
  },
];

// ============================================================================
// EXPORT ALL TOOLS
// ============================================================================

export const editorTools: Tool[] = [
  ...transcriptTools,
  ...navigationTools,
  ...textOverlayTools,
  ...captionTools,
  ...generationTools,
  ...audioTools,
  ...effectsTools,
  ...analysisTools,
];

// Tool categories for reference
export const toolCategories = {
  transcript: ["delete_words", "restore_words", "smart_cuts", "reorder_clips", "trim_clip", "get_transcript", "get_project_status", "undo", "redo"],
  navigation: ["seek_to", "set_playback_rate"],
  textOverlay: ["add_text_overlay", "edit_text_overlay", "remove_element"],
  captions: ["apply_caption_preset", "customize_caption_style", "highlight_keywords"],
  generation: ["generate_broll_image", "generate_video_clip", "extend_video", "video_to_video"],
  audio: ["add_audio_visualization", "adjust_audio"],
  effects: ["apply_transition", "apply_video_filter", "add_shape"],
  analysis: ["analyze_transcript", "suggest_broll_moments", "find_key_moments"],
};

// Helper type for tool inputs
export type ToolName = typeof editorTools[number]["name"];

// Comprehensive type definitions for tool inputs
export interface ToolInput {
  delete_words: {
    query: string;
    clipId?: string;
    matchType?: "exact" | "contains" | "starts_with" | "ends_with";
  };
  restore_words: {
    wordIds?: string[];
    restoreAll?: boolean;
    query?: string;
  };
  smart_cuts: {
    mode: "suggest" | "apply" | "review";
    targets: ("filler-words" | "long-pauses" | "repeated-phrases" | "sentence-starters")[];
    sensitivity?: "low" | "medium" | "high";
  };
  reorder_clips: {
    clipId?: string;
    direction?: "up" | "down" | "first" | "last";
    newOrder?: string[];
  };
  trim_clip: {
    clipId: string;
    startMs?: number;
    endMs?: number;
  };
  get_transcript: {
    includeDeleted?: boolean;
    clipId?: string;
    format?: "full" | "text-only" | "words-with-timing";
  };
  get_project_status: {
    detailed?: boolean;
  };
  seek_to: {
    timeMs?: number;
    phrase?: string;
    position?: "start" | "end" | "middle";
  };
  set_playback_rate: {
    rate: number;
  };
  add_text_overlay: {
    text: string;
    style?: "title" | "subtitle" | "lower-third" | "callout" | "quote" | "heading" | "body";
    startMs?: number;
    durationMs?: number;
    position?: {
      horizontal?: "left" | "center" | "right";
      vertical?: "top" | "middle" | "bottom";
    };
    animation?: {
      in?: string;
      out?: string;
      loop?: string;
    };
    styling?: {
      fontFamily?: string;
      fontSize?: number;
      fontWeight?: "normal" | "bold" | "light";
      color?: string;
      backgroundColor?: string;
      textShadow?: boolean;
      textStroke?: boolean;
      textTransform?: "none" | "uppercase" | "lowercase" | "capitalize";
    };
  };
  edit_text_overlay: {
    elementId: string;
    updates: {
      text?: string;
      startMs?: number;
      durationMs?: number;
      color?: string;
      fontSize?: number;
      animation?: string;
    };
  };
  remove_element: {
    elementId: string;
  };
  apply_caption_preset: {
    preset: string;
  };
  customize_caption_style: {
    colors?: {
      activeColor?: string;
      appearedColor?: string;
      baseColor?: string;
      activeFillColor?: string;
      keywordColor?: string;
    };
    typography?: {
      fontFamily?: string;
      fontSize?: number;
      fontWeight?: string;
      textTransform?: "none" | "uppercase" | "lowercase";
      letterSpacing?: number;
    };
    effects?: {
      textStroke?: boolean;
      strokeWidth?: number;
      strokeColor?: string;
      textShadow?: boolean;
      shadowColor?: string;
      shadowBlur?: number;
    };
    animation?: string;
    layout?: {
      position?: "top" | "middle" | "bottom";
      alignment?: "left" | "center" | "right";
      linesPerCaption?: number;
      wordsPerLine?: "auto" | "single" | "punctuation";
    };
  };
  highlight_keywords: {
    keywords: string[];
    style?: {
      color?: string;
      scale?: number;
      animation?: string;
    };
  };
  generate_broll_image: {
    prompt: string;
    style?: "photorealistic" | "illustration" | "cinematic" | "minimalist" | "abstract" | "3d-render" | "anime";
    aspectRatio?: "9:16" | "16:9" | "1:1" | "4:5";
    insertAt?: number;
    durationMs?: number;
  };
  generate_video_clip: {
    prompt: string;
    style?: "cinematic" | "documentary" | "commercial" | "social-media" | "artistic" | "realistic";
    duration?: 4 | 6 | 8;
    aspectRatio?: "9:16" | "16:9" | "1:1";
    referenceImage?: string;
    withAudio?: boolean;
  };
  extend_video: {
    clipId: string;
    direction: "before" | "after";
    durationSeconds?: number;
    prompt?: string;
  };
  video_to_video: {
    clipId: string;
    effect: "style-transfer" | "enhance" | "slow-motion" | "color-grade" | "anime-style" | "cartoon-style" | "cinematic-grade" | "vintage";
    prompt?: string;
    intensity?: number;
  };
  add_audio_visualization: {
    type: "linear-bars" | "wave" | "hill" | "radial";
    style?: {
      color?: string;
      thickness?: number;
      gap?: number;
      roundness?: number;
      height?: number;
    };
    position?: { x?: number; y?: number };
    startMs?: number;
    durationMs?: number;
  };
  adjust_audio: {
    clipId: string;
    volume?: number;
    fadeInMs?: number;
    fadeOutMs?: number;
  };
  apply_transition: {
    type: "crossfade" | "slide-left" | "slide-right" | "slide-up" | "slide-down" | "circle-reveal" | "rectangle-wipe" | "star-burst" | "sliding-doors" | "zoom";
    atMs?: number;
    durationMs?: number;
  };
  apply_video_filter: {
    clipId?: string;
    filters: {
      brightness?: number;
      contrast?: number;
      saturation?: number;
      blur?: number;
      vignette?: number;
    };
  };
  add_shape: {
    shape: "rectangle" | "circle" | "ellipse" | "arrow" | "line" | "star" | "triangle";
    position?: { x?: number; y?: number };
    size?: { width?: number; height?: number };
    style?: {
      fillColor?: string;
      strokeColor?: string;
      strokeWidth?: number;
      opacity?: number;
    };
    startMs?: number;
    durationMs?: number;
    animation?: "none" | "fadeIn" | "scaleIn" | "drawIn" | "popIn";
  };
  analyze_transcript: {
    analysisType: ("filler-words" | "pacing" | "structure" | "key-moments" | "broll-opportunities" | "caption-suggestions" | "cut-points")[];
  };
  suggest_broll_moments: {
    maxSuggestions?: number;
    style?: "any" | "images-only" | "videos-only";
  };
  find_key_moments: {
    purpose?: "social-clips" | "highlights" | "chapters" | "quotes";
    maxMoments?: number;
  };
}
