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
  console.log("\n" + "=".repeat(80));
  console.log("[PASS 1 - UNDERSTAND + DEDUPE] INPUT");
  console.log("=".repeat(80));
  console.log(`Clips received: ${clips.length}`);
  clips.forEach((clip, i) => {
    console.log(`\n--- Clip ${i + 1} (${clip.clipId}) ---`);
    console.log(`Words: ${clip.words.length}`);
    console.log(`Text: "${clip.text.substring(0, 200)}${clip.text.length > 200 ? '...' : ''}"`);
  });

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

  console.log("\n" + "-".repeat(80));
  console.log("[PASS 1] FULL RAW RESPONSE:");
  console.log("-".repeat(80));
  console.log(responseText);
  console.log("-".repeat(80));

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

  console.log("\n[PASS 1] PARSED RESULT:");
  console.log(`Understanding: "${result.understanding}"`);
  console.log(`Clips to remove (${result.clipsToRemove.length}):`);
  result.clipsToRemove.forEach(c => {
    console.log(`  - ${c.clipId}: ${c.reason}`);
  });
  console.log(`Unique clips to keep (${result.uniqueClipIds.length}): ${result.uniqueClipIds.join(", ")}`);
  console.log("=".repeat(80) + "\n");

  return result;
}

// ============================================================================
// PASS 2: Order
// ============================================================================

async function runPass2(clips: ClipTranscript[], understanding: string) {
  console.log("\n" + "=".repeat(80));
  console.log("[PASS 2 - ORDER] INPUT");
  console.log("=".repeat(80));
  console.log(`Understanding from Pass 1: "${understanding}"`);
  console.log(`Clips to order: ${clips.length}`);
  clips.forEach((clip, i) => {
    console.log(`  ${i + 1}. ${clip.clipId} - "${clip.text.substring(0, 100)}..."`);
  });

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

  console.log("\n" + "-".repeat(80));
  console.log("[PASS 2] FULL RAW RESPONSE:");
  console.log("-".repeat(80));
  console.log(responseText);
  console.log("-".repeat(80));

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

  console.log("\n[PASS 2] PARSED RESULT:");
  console.log(`Suggested order: ${result.suggestedOrder.join(" -> ")}`);
  console.log(`Reasoning: "${result.orderReasoning}"`);
  console.log("=".repeat(80) + "\n");

  return result;
}

// ============================================================================
// PASS 3: Refine + Hooks
// ============================================================================

async function runPass3(clips: ClipTranscript[]) {
  console.log("\n" + "=".repeat(80));
  console.log("[PASS 3 - REFINE + HOOKS] INPUT");
  console.log("=".repeat(80));
  console.log(`Clips to refine: ${clips.length}`);
  clips.forEach((clip, i) => {
    console.log(`\n--- Clip ${i + 1} (${clip.clipId}) ---`);
    console.log(`Text: "${clip.text}"`);
    console.log(`Words (${clip.words.length}):`);
    console.log(clip.words.map(w => `  "${w.text}" [${w.id}]`).join("\n"));
  });

  // Build the full ordered script - USE NEW ORDER INDEX (i+1), not original clipIndex
  const fullScript = clips.map((clip, i) =>
    `=== CLIP ${i + 1} (ID: ${clip.clipId}) ===\n${clip.text}`
  ).join("\n\n");

  // Build word context for surgical cuts - USE NEW ORDER INDEX
  const wordsContext = clips.map((clip, i) => {
    return `CLIP ${i + 1} (${clip.clipId}) - ALL ${clip.words.length} WORDS:\n${clip.words.map(w => `"${w.text}" [${w.id}]`).join(" ")}`;
  }).join("\n\n");

  console.log("\n[PASS 3] WORDS CONTEXT BEING SENT:");
  console.log(wordsContext);

  const systemPrompt = `You are doing a final polish on a video script.

The clips are already in optimal order with duplicates removed. Your job is to make CONSERVATIVE cuts that improve the script WITHOUT breaking grammar.

## WORD CUTS - BE VERY CONSERVATIVE

ONLY cut these specific patterns:
- **Stuttering**: Repeated words in immediate sequence ("I I I think" → keep only last "I")
- **Repeated filler in sequence**: ("so so so" → keep one "so")
- **Obvious filler words**: "um", "uh", "like" when used as filler (not "like" meaning similar)
- **Broken/garbled speech**: Words that are clearly transcription errors or nonsensical

DO NOT cut:
- Transition phrases ("And not only", "But also", "So anyway") - these connect ideas
- Words that would break grammar if removed
- "Just", "really", "actually" unless repeated in immediate sequence
- Anything where removing it would make the sentence sound unnatural

## CRITICAL: VERIFY EACH CUT
Before including a cut, mentally read the sentence WITHOUT those words.
If it sounds broken, ungrammatical, or unnatural → DO NOT INCLUDE THAT CUT.

Example of BAD cut:
- Original: "And not only this watermelon crazy"
- Cutting "And not only" → "this watermelon crazy" ← BROKEN GRAMMAR, don't cut

Example of GOOD cut:
- Original: "This this is crazy"
- Cutting first "This" → "This is crazy" ← STILL GRAMMATICAL, good cut

## TEXT HOOK
Find THE most attention-grabbing line (5-10 words max).
Should be scroll-stopping for TikTok/Instagram.

## EMPHASIS POINTS
Identify 2-4 moments for zoom effects: numbers, bold claims, emotional peaks.`;

  const userPrompt = `Here's the ordered script to refine:

${fullScript}

WORD IDS (use these for surgical cuts):
${wordsContext}

Tasks:
1. Find ONLY stuttering/repeated words to cut (be very conservative!)
2. Find the BEST hook line (5-10 words, scroll-stopping)
3. Find 2-4 emphasis moments for zoom effects

IMPORTANT: For each potential cut, verify the resulting sentence is still grammatical.
Only include cuts where the words are IMMEDIATELY REPEATED (stuttering) or clearly broken speech.

Return JSON:
{
  "wordCuts": [
    {
      "clipId": "...",
      "wordIds": ["word-id-1", "word-id-2"],
      "reason": "Why these words should be cut (must be stuttering or broken speech)",
      "text": "The words being cut",
      "resultingSentence": "What the sentence looks like AFTER the cut (to verify grammar)"
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

  console.log("\n" + "-".repeat(80));
  console.log("[PASS 3] FULL RAW RESPONSE:");
  console.log("-".repeat(80));
  console.log(responseText);
  console.log("-".repeat(80));

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

  console.log("\n[PASS 3] PARSED RESULT:");
  console.log(`Text Hook: "${result.textHook}"`);
  console.log(`\nWord Cuts (${result.wordCuts.length}):`);
  result.wordCuts.forEach((cut: any, i: number) => {
    console.log(`  ${i + 1}. Clip: ${cut.clipId}`);
    console.log(`     Cutting: "${cut.text}"`);
    console.log(`     Word IDs: ${cut.wordIds?.join(", ")}`);
    console.log(`     Reason: ${cut.reason}`);
    if (cut.resultingSentence) {
      console.log(`     Result: "${cut.resultingSentence}"`);
    }
  });
  console.log(`\nTotal word IDs to delete: ${wordIdsToDelete.length}`);
  console.log(`Word IDs: ${wordIdsToDelete.join(", ")}`);
  console.log(`\nEmphasis Points (${result.emphasisPoints.length}):`);
  result.emphasisPoints.forEach((ep, i) => {
    console.log(`  ${i + 1}. "${ep.text}" - ${ep.reason}`);
  });
  console.log("=".repeat(80) + "\n");

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

    console.log("\n" + "#".repeat(80));
    console.log(`[ANALYZE-CUTS API] INCOMING REQUEST - Pass ${pass || "legacy"}`);
    console.log("#".repeat(80));
    console.log(`Clips: ${clips?.length || 0}`);
    if (understanding) {
      console.log(`Understanding context: "${understanding.substring(0, 100)}..."`);
    }

    if (!clips || clips.length === 0) {
      console.log("No clips provided, returning empty response");
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
