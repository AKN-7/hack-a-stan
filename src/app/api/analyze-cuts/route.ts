import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

interface ClipTranscript {
  clipId: string;
  clipIndex: number;
  text: string;
  words: Array<{
    id: string;
    text: string;
    startMs: number;
    endMs: number;
  }>;
}

// ============================================================================
// PASS 1: Understand + Dedupe
// ============================================================================

async function runPass1(clips: ClipTranscript[]) {
  const transcriptContext = clips.map(clip =>
    `=== CLIP ${clip.clipIndex} (ID: ${clip.clipId}) ===\n${clip.text}`
  ).join("\n\n");

  const systemPrompt = `You are analyzing video clips to understand the content and identify duplicate takes.

Your job is to:
1. Read all the transcripts and understand what this person is trying to communicate
2. Notice if any clips cover the same content (duplicate takes, same intro recorded twice, same point explained with different wording)
3. For duplicates, pick the best version (cleaner delivery, more confident, better phrasing)

WHAT COUNTS AS DUPLICATES (remove the worse one):
- Two clips both introducing themselves ("I'm X at Y company" vs "I'm the founder of Y")
- Same concept explained with minor word differences
- Same purpose even if words differ slightly
- Re-recorded sections where the creator started over

WHAT COUNTS AS UNIQUE (keep both):
- Different topics, examples, or stories
- Additional details not covered elsewhere
- Genuinely new information

Be intelligent about this. Don't follow rigid rules - understand the MEANING and PURPOSE of each clip.`;

  const userPrompt = `Read these ${clips.length} clips carefully:

${transcriptContext}

First, understand what this content is about overall.

Then, identify any duplicate takes - clips that cover the same ground. For each group of duplicates, pick the best version to keep.

Return JSON:
{
  "understanding": "Brief description of what this content is about (2-3 sentences)",
  "clipsToRemove": [
    {
      "clipId": "actual-clip-id",
      "reason": "Why this clip should be removed (e.g., 'Duplicate intro - Clip 2 has better delivery')"
    }
  ],
  "uniqueClipIds": ["clip-id-1", "clip-id-2"]  // All clips that should be KEPT
}

Use actual clipId values like "${clips[0]?.clipId}".
Return ONLY valid JSON.`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    temperature: 0,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const responseText = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map(block => block.text)
    .join("");

  console.log("[Pass 1 - Understand+Dedupe] Raw response:", responseText.substring(0, 500));

  // Parse response
  let result = {
    understanding: "",
    clipsToRemove: [] as Array<{ clipId: string; reason: string }>,
    uniqueClipIds: [] as string[],
  };

  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      result = {
        understanding: parsed.understanding || "",
        clipsToRemove: (parsed.clipsToRemove || []).map((item: any) => ({
          clipId: typeof item === 'string' ? item : item.clipId,
          reason: typeof item === 'string' ? 'Duplicate take' : (item.reason || 'Duplicate take'),
        })),
        uniqueClipIds: parsed.uniqueClipIds || [],
      };
    }
  } catch (parseError) {
    console.error("[Pass 1] Failed to parse:", parseError);
    // Fallback: keep all clips
    result.uniqueClipIds = clips.map(c => c.clipId);
  }

  // Ensure uniqueClipIds doesn't include removed clips
  const removedIds = new Set(result.clipsToRemove.map(c => c.clipId));
  result.uniqueClipIds = result.uniqueClipIds.filter(id => !removedIds.has(id));

  // If uniqueClipIds is empty but we have clips, keep all non-removed clips
  if (result.uniqueClipIds.length === 0) {
    result.uniqueClipIds = clips.map(c => c.clipId).filter(id => !removedIds.has(id));
  }

  console.log("[Pass 1] Result:", {
    understanding: result.understanding.substring(0, 100),
    clipsToRemove: result.clipsToRemove.length,
    uniqueClipIds: result.uniqueClipIds.length,
  });

  return result;
}

// ============================================================================
// PASS 2: Order
// ============================================================================

async function runPass2(clips: ClipTranscript[], understanding: string) {
  const transcriptContext = clips.map(clip =>
    `=== CLIP ${clip.clipIndex} (ID: ${clip.clipId}) ===\n${clip.text}`
  ).join("\n\n");

  const systemPrompt = `You are arranging video clips into the best narrative order.

The duplicates have already been removed. You're working with unique, valuable content.

Context about this content:
${understanding}

Your job is to arrange these clips so they tell a compelling, coherent story.

Think about:
- What opening would grab attention for THIS topic?
- How do these ideas connect and build on each other?
- What order makes THIS message land best?
- What's a natural conclusion?

Don't follow a rigid template like "intro then body then outro". Think about what serves THIS SPECIFIC content. A tutorial might need step-by-step order. A pitch might need hook-problem-solution. A story might need chronological order. Adapt to the content.`;

  const userPrompt = `Here are ${clips.length} unique clips to arrange:

${transcriptContext}

Arrange these into the optimal order for THIS content. Consider what makes sense for the specific topic and style.

Return JSON:
{
  "suggestedOrder": ["clip-id-1", "clip-id-2", "clip-id-3"],  // All clipIds in optimal order
  "orderReasoning": "Brief explanation of why this order works for this content"
}

Use actual clipId values like "${clips[0]?.clipId}".
Return ONLY valid JSON.`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    temperature: 0,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const responseText = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map(block => block.text)
    .join("");

  console.log("[Pass 2 - Order] Raw response:", responseText.substring(0, 500));

  let result = {
    suggestedOrder: [] as string[],
    orderReasoning: "",
  };

  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      result = {
        suggestedOrder: parsed.suggestedOrder || [],
        orderReasoning: parsed.orderReasoning || "",
      };
    }
  } catch (parseError) {
    console.error("[Pass 2] Failed to parse:", parseError);
    // Fallback: keep original order
    result.suggestedOrder = clips.map(c => c.clipId);
  }

  // Ensure all input clips are in the order
  const orderedSet = new Set(result.suggestedOrder);
  const missingClips = clips.filter(c => !orderedSet.has(c.clipId)).map(c => c.clipId);
  if (missingClips.length > 0) {
    result.suggestedOrder = [...result.suggestedOrder, ...missingClips];
  }

  console.log("[Pass 2] Result:", {
    suggestedOrder: result.suggestedOrder,
    orderReasoning: result.orderReasoning.substring(0, 100),
  });

  return result;
}

// ============================================================================
// PASS 3: Refine + Hooks
// ============================================================================

async function runPass3(clips: ClipTranscript[]) {
  // Build the full ordered script
  const fullScript = clips.map(clip =>
    `=== CLIP ${clip.clipIndex} (ID: ${clip.clipId}) ===\n${clip.text}`
  ).join("\n\n");

  // Build word context for surgical cuts
  const wordsContext = clips.map(clip => {
    if (clip.words.length <= 50) {
      return `CLIP ${clip.clipIndex} WORDS:\n${clip.words.map(w => `"${w.text}" [${w.id}]`).join(" ")}`;
    }
    const first5 = clip.words.slice(0, 5).map(w => `"${w.text}" [${w.id}]`).join(" ");
    const last5 = clip.words.slice(-5).map(w => `"${w.text}" [${w.id}]`).join(" ");
    return `CLIP ${clip.clipIndex} (${clip.words.length} words): ${first5} ... ${last5}`;
  }).join("\n\n");

  const systemPrompt = `You are doing a final polish on a video script.

The clips are already in optimal order with duplicates removed. Your job is to:

1. **REFINE**: Read the full script as one piece. Find remaining repetition or phrases that could be tightened. Look for:
   - Same idea mentioned in two different clips
   - Stuttering or false starts ("I, I, I think" → cut first two "I"s)
   - Filler phrases that add nothing
   - Repeated transitions ("so, so, so")

2. **TEXT HOOK**: Find THE most attention-grabbing line from this content.
   - Should be 5-10 words max
   - Scroll-stopping (would make someone stop on TikTok/Instagram)
   - Usually a bold claim, impressive number, or intriguing statement

3. **EMPHASIS POINTS**: Identify 2-4 moments that deserve emphasis (for zoom effects):
   - Numbers/statistics
   - Bold claims or statements
   - Emotional peaks
   - Key revelations

Be intelligent about word cuts. Don't just pattern match - understand what makes the script tighter and punchier.`;

  const userPrompt = `Here's the ordered script to refine:

${fullScript}

WORD IDS (use these for surgical cuts):
${wordsContext}

Tasks:
1. Find word-level cuts to tighten the script
2. Find the BEST hook line (5-10 words, scroll-stopping)
3. Find 2-4 emphasis moments for zoom effects

Return JSON:
{
  "wordCuts": [
    {
      "clipId": "...",
      "wordIds": ["word-id-1", "word-id-2"],
      "reason": "Why these words should be cut",
      "text": "The words being cut"
    }
  ],
  "textHook": "The most attention-grabbing line (5-10 words)",
  "emphasisPoints": [
    {
      "clipId": "...",
      "wordId": "word-id",
      "reason": "Why this moment deserves emphasis",
      "text": "The emphasized phrase"
    }
  ]
}

Use actual IDs from the word lists above.
Return ONLY valid JSON.`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    temperature: 0,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const responseText = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map(block => block.text)
    .join("");

  console.log("[Pass 3 - Refine+Hooks] Raw response:", responseText.substring(0, 500));

  let result = {
    wordCuts: [] as Array<{ clipId: string; wordIds: string[]; reason: string; text: string }>,
    textHook: "",
    emphasisPoints: [] as Array<{ clipId: string; wordId: string; reason: string; text: string }>,
  };

  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      result = {
        wordCuts: parsed.wordCuts || [],
        textHook: parsed.textHook || "",
        emphasisPoints: parsed.emphasisPoints || [],
      };
    }
  } catch (parseError) {
    console.error("[Pass 3] Failed to parse:", parseError);
  }

  // Flatten word IDs
  const wordIdsToDelete = result.wordCuts.flatMap(cut => cut.wordIds || []);

  console.log("[Pass 3] Result:", {
    wordCutsCount: result.wordCuts.length,
    wordIdsToDelete: wordIdsToDelete.length,
    textHook: result.textHook,
    emphasisPointsCount: result.emphasisPoints.length,
  });

  return {
    ...result,
    wordIdsToDelete,
  };
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { clips, pass, understanding } = body as {
      clips: ClipTranscript[];
      pass?: number;
      understanding?: string;
    };

    if (!clips || clips.length === 0) {
      return Response.json({ actions: [], message: "No clips to analyze" });
    }

    // Route to appropriate pass
    switch (pass) {
      case 1: {
        const result = await runPass1(clips);
        return Response.json({
          success: true,
          pass: 1,
          ...result,
        });
      }

      case 2: {
        const result = await runPass2(clips, understanding || "");
        return Response.json({
          success: true,
          pass: 2,
          ...result,
        });
      }

      case 3: {
        const result = await runPass3(clips);
        return Response.json({
          success: true,
          pass: 3,
          ...result,
        });
      }

      default: {
        // Legacy: run all passes in sequence (for backward compatibility)
        console.log("[Analyze Cuts] Running legacy single-call mode");

        // Pass 1
        const pass1Result = await runPass1(clips);

        // Filter to unique clips for Pass 2
        const uniqueClips = clips.filter(c => pass1Result.uniqueClipIds.includes(c.clipId));

        // Pass 2
        const pass2Result = await runPass2(uniqueClips, pass1Result.understanding);

        // Order clips for Pass 3
        const orderedClips = pass2Result.suggestedOrder
          .map(id => uniqueClips.find(c => c.clipId === id))
          .filter((c): c is ClipTranscript => c !== undefined);

        // Pass 3
        const pass3Result = await runPass3(orderedClips);

        // Combine results (legacy format)
        return Response.json({
          success: true,
          suggestedOrder: pass2Result.suggestedOrder,
          clipsToRemove: pass1Result.clipsToRemove.map((c, idx) => ({
            ...c,
            clipIndex: idx + 1,
          })),
          wordCuts: pass3Result.wordCuts,
          wordIdsToDelete: pass3Result.wordIdsToDelete,
          emphasisPoints: pass3Result.emphasisPoints,
          textHook: pass3Result.textHook,
          reasoning: pass2Result.orderReasoning,
          message: `AI analysis complete: ${pass1Result.clipsToRemove.length} clips to remove, ${pass3Result.wordCuts.length} sections to cut`,
        });
      }
    }
  } catch (error) {
    console.error("Analyze cuts error:", error);
    return Response.json(
      { error: "Failed to analyze transcript", details: String(error) },
      { status: 500 }
    );
  }
}
