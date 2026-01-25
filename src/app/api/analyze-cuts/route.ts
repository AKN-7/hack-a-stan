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

interface SentenceData {
  id: string;           // e.g., "clip1-sent0"
  clipId: string;       // Parent clip
  text: string;         // Full sentence text
  startMs: number;
  endMs: number;
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

  const systemPrompt = `You are analyzing video clips to identify true duplicates vs unique content.

CRITICAL: Only remove clips that are TRUE RE-TAKES of the exact same content.

WHAT IS A TRUE DUPLICATE (consolidate - pick best one):
- Same sentence said twice with minor word differences
- Same introduction recorded multiple times
- Creator clearly started over and re-recorded the same thing

WHAT IS NOT A DUPLICATE (keep both - they add different value):
- Different ANGLES on the same topic (e.g., facts vs social proof vs personal reaction)
- Different DETAILS even if same general topic
- Different CONTEXT (e.g., one sets location, another gives specs)
- One clip has information the other doesn't

BE CONSERVATIVE. When in doubt, keep both clips.
The goal is to remove obvious re-takes, NOT to aggressively cut content.

EXAMPLE - 3 clips about a watermelon:
- Clip A: "This watermelon is 45 pounds and costs $300" → FACTS
- Clip B: "Everyone in the store is stopping to take photos" → SOCIAL PROOF
- Clip C: "I'm in Korea and this is the craziest watermelon" → CONTEXT
These are NOT duplicates - they each add unique value. Keep all 3.

EXAMPLE - 3 clips that ARE duplicates:
- Clip A: "I'm John, the founder of Acme"
- Clip B: "I'm John, I founded Acme"
- Clip C: "Hey, I'm John, founder at Acme"
These ARE duplicates - same intro recorded 3 times. Pick the best one.`;

  const userPrompt = `Read these ${clips.length} clips carefully:

${transcriptContext}

STEP 1: Does each clip add UNIQUE information or perspective?
- Different facts, details, or numbers = UNIQUE
- Different angle (social proof vs specs vs context) = UNIQUE
- Same sentence re-recorded = DUPLICATE

STEP 2: Only group clips that are TRUE re-takes of the exact same content.
If clips have different information, they are NOT duplicates.

STEP 3: For each group of true duplicates, pick the best one.
Clips with unique content should each be their own "group" with themselves as the winner.

Return JSON:
{
  "understanding": "Brief description of what this content is about (2-3 sentences)",
  "thematicGroups": [
    {
      "theme": "Name of this theme (e.g., 'Introduction')",
      "clipIds": ["all", "clips", "covering", "this", "theme"],
      "winnerId": "the-single-best-clip-id",
      "winnerReason": "Why this clip won (delivery, completeness, phrasing)"
    }
  ],
  "clipsToRemove": [
    {
      "clipId": "clip-id",
      "reason": "Lost to [winner] for [theme] - [specific reason]"
    }
  ],
  "uniqueClipIds": ["winner-1", "winner-2"]  // ONE winner per theme only
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
    thematicGroups: [] as Array<{ theme: string; clipIds: string[]; winnerId: string; winnerReason: string }>,
    clipsToRemove: [] as Array<{ clipId: string; reason: string }>,
    uniqueClipIds: [] as string[],
  };

  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);

      // Handle new thematic groups format
      const thematicGroups = parsed.thematicGroups || [];

      // Extract winners from thematic groups
      const winners = new Set(thematicGroups.map((g: any) => g.winnerId).filter(Boolean));

      // Build clipsToRemove from thematic groups (losers)
      // IMPORTANT: Only remove a clip if it's NOT a winner in ANY group
      // A clip can be in multiple groups - it might lose in one but have unique content in another
      const clipsToRemove: Array<{ clipId: string; reason: string }> = [];
      for (const group of thematicGroups) {
        for (const clipId of (group.clipIds || [])) {
          // Only remove if: not the winner in this group AND not a winner in any other group
          if (clipId !== group.winnerId && !winners.has(clipId)) {
            // Avoid adding the same clip twice
            if (!clipsToRemove.find(c => c.clipId === clipId)) {
              clipsToRemove.push({
                clipId,
                reason: `Lost to ${group.winnerId} for "${group.theme}" - ${group.winnerReason || 'better take'}`,
              });
            }
          }
        }
      }

      // Also include any explicit clipsToRemove from response
      if (parsed.clipsToRemove) {
        for (const item of parsed.clipsToRemove) {
          const clipId = typeof item === 'string' ? item : item.clipId;
          if (!clipsToRemove.find(c => c.clipId === clipId)) {
            clipsToRemove.push({
              clipId,
              reason: typeof item === 'string' ? 'Duplicate take' : (item.reason || 'Duplicate take'),
            });
          }
        }
      }

      result = {
        understanding: parsed.understanding || "",
        thematicGroups,
        clipsToRemove,
        uniqueClipIds: parsed.uniqueClipIds || Array.from(winners) as string[],
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
  console.log(`\nThematic Groups (${result.thematicGroups.length}):`);
  result.thematicGroups.forEach((g, i) => {
    console.log(`  ${i + 1}. "${g.theme}": ${g.clipIds?.length || 0} clips → Winner: ${g.winnerId}`);
    console.log(`     Reason: ${g.winnerReason}`);
  });
  console.log(`\nClips to remove (${result.clipsToRemove.length}):`);
  result.clipsToRemove.forEach(c => {
    console.log(`  - ${c.clipId}: ${c.reason}`);
  });
  console.log(`\nFinal unique clips (${result.uniqueClipIds.length}): ${result.uniqueClipIds.join(", ")}`);
  console.log("=".repeat(80) + "\n");

  return result;
}

// ============================================================================
// PASS 2: Order
// ============================================================================

async function runPass2(clips: ClipTranscript[], understanding: string, sentences?: SentenceData[]) {
  // If sentences are provided, use sentence-level ordering for finer control
  if (sentences && sentences.length > 0) {
    return runPass2Sentences(sentences, understanding);
  }

  // Fall back to clip-level ordering
  console.log("\n" + "=".repeat(80));
  console.log("[PASS 2 - ORDER (CLIP-LEVEL)] INPUT");
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
    suggestedSentenceOrder: [] as string[],
    orderReasoning: "",
  };

  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      result = {
        suggestedOrder: parsed.suggestedOrder || [],
        suggestedSentenceOrder: [],
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
// PASS 2 (SENTENCE-LEVEL): Order sentences for fine-grained control
// ============================================================================

async function runPass2Sentences(sentences: SentenceData[], understanding: string) {
  console.log("\n" + "=".repeat(80));
  console.log("[PASS 2 - ORDER (SENTENCE-LEVEL)] INPUT");
  console.log("=".repeat(80));
  console.log(`Understanding from Pass 1: "${understanding}"`);
  console.log(`Sentences to order: ${sentences.length}`);
  sentences.forEach((s, i) => {
    console.log(`  ${i + 1}. ${s.id} - "${s.text.substring(0, 80)}${s.text.length > 80 ? '...' : ''}"`);
  });

  const sentenceContext = sentences.map((s, i) =>
    `[${i + 1}] ID: ${s.id}\n"${s.text}"`
  ).join("\n\n");

  const systemPrompt = `You are arranging SENTENCES (not clips) into the best narrative order.

Duplicate clips have been removed. These are all the individual sentences from the remaining content.

Context about this content:
${understanding}

Your job is to arrange these SENTENCES for the most compelling, coherent narrative.

IMPORTANT - You can:
- Interleave sentences from different clips
- Put the most attention-grabbing sentence first (not necessarily from the first clip)
- Build ideas logically - each sentence should flow from the previous
- End with a strong conclusion or call to action

Think about the FLOW of ideas, not which clip they came from. A sentence from Clip 3 might be the perfect opener, followed by context from Clip 1.`;

  const userPrompt = `Here are ${sentences.length} sentences to arrange:

${sentenceContext}

Arrange these SENTENCES into the optimal order for a compelling narrative.
You CAN interleave sentences from different clips - arrange by meaning, not by source.

Return JSON:
{
  "suggestedSentenceOrder": ["${sentences[0]?.id}", "${sentences[1]?.id || 'sentence-id-2'}", ...],
  "orderReasoning": "Brief explanation of why this sentence order creates the best narrative flow"
}

Use the EXACT sentence IDs shown above (like "${sentences[0]?.id}").
Include ALL sentence IDs in your order - don't skip any.
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
  console.log("[PASS 2 SENTENCES] FULL RAW RESPONSE:");
  console.log("-".repeat(80));
  console.log(responseText);
  console.log("-".repeat(80));

  let result = {
    suggestedOrder: [] as string[],
    suggestedSentenceOrder: [] as string[],
    orderReasoning: "",
  };

  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      result = {
        suggestedOrder: [],
        suggestedSentenceOrder: parsed.suggestedSentenceOrder || [],
        orderReasoning: parsed.orderReasoning || "",
      };
    }
  } catch (parseError) {
    console.error("[Pass 2 Sentences] Failed to parse:", parseError);
    // Fallback: keep original order
    result.suggestedSentenceOrder = sentences.map(s => s.id);
  }

  // DEDUPLICATE: AI might return the same sentence ID multiple times - keep only first occurrence
  const seenIds = new Set<string>();
  const deduped: string[] = [];
  for (const id of result.suggestedSentenceOrder) {
    if (!seenIds.has(id)) {
      seenIds.add(id);
      deduped.push(id);
    }
  }
  if (deduped.length !== result.suggestedSentenceOrder.length) {
    console.log(`[Pass 2 Sentences] Removed ${result.suggestedSentenceOrder.length - deduped.length} duplicate sentence IDs from order`);
  }
  result.suggestedSentenceOrder = deduped;

  // Ensure all input sentences are in the order
  const orderedSet = new Set(result.suggestedSentenceOrder);
  const missingSentences = sentences.filter(s => !orderedSet.has(s.id)).map(s => s.id);
  if (missingSentences.length > 0) {
    console.log(`[Pass 2 Sentences] Adding ${missingSentences.length} missing sentences to end`);
    result.suggestedSentenceOrder = [...result.suggestedSentenceOrder, ...missingSentences];
  }

  console.log("\n[PASS 2 SENTENCES] PARSED RESULT:");
  console.log(`Suggested sentence order (${result.suggestedSentenceOrder.length} sentences):`);
  result.suggestedSentenceOrder.slice(0, 5).forEach((id, i) => {
    const sentence = sentences.find(s => s.id === id);
    console.log(`  ${i + 1}. ${id}: "${sentence?.text.substring(0, 50)}..."`);
  });
  if (result.suggestedSentenceOrder.length > 5) {
    console.log(`  ... and ${result.suggestedSentenceOrder.length - 5} more`);
  }
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

## WORD CUTS - ONLY TWO TYPES ALLOWED

1. **STUTTERING**: The EXACT same word appears twice IN A ROW
   - "I I think" → cut one "I"
   - "the the" → cut one "the"
   - "look look" → cut one "look"

2. **FILLER SOUNDS**: Only these specific sounds: "um", "uh", "er", "ah"
   - These are pure noise with no meaning
   - Always safe to remove

## THAT'S IT. NOTHING ELSE.

Do NOT cut:
- Words that appear multiple times but NOT in immediate sequence
- Words you think are "filler" like "like", "just", "so", "actually", "really"
- Transition phrases
- Anything that would change the meaning or grammar

The rule is simple: if you have to think about whether to cut it, DON'T CUT IT.

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
// PASS 4: Semantic Deduplication (sentence-level)
// ============================================================================

async function runPass4(sentences: SentenceData[]) {
  console.log("\n" + "=".repeat(80));
  console.log("[PASS 4 - SEMANTIC DEDUPLICATION] INPUT");
  console.log("=".repeat(80));
  console.log(`Sentences to analyze: ${sentences.length}`);
  sentences.forEach((s, i) => {
    console.log(`  ${i + 1}. ${s.id}: "${s.text.substring(0, 60)}${s.text.length > 60 ? '...' : ''}"`);
  });

  const sentenceContext = sentences.map((s, i) =>
    `[${i + 1}] ID: ${s.id}\n"${s.text}"`
  ).join("\n\n");

  const systemPrompt = `You are doing a final polish pass to remove REDUNDANT SENTENCES from a video script.

IMPORTANT CONTEXT:
- Pass 1 already removed duplicate CLIPS (same take recorded multiple times)
- Now you're looking at the remaining sentences across all kept clips
- Your job is to find REDUNDANT SENTENCES that say the same thing or express the same sentiment

WHAT TO DELETE:

1. **LITERAL DUPLICATES**: The exact same sentence appearing twice
   - "I built the tool" ... later ... "I built the tool" → delete one

2. **SENTIMENT DUPLICATES**: Multiple sentences expressing the same reaction/feeling
   - "This is crazy" + "That's crazy" + "Insane" + "Crazy!" → Keep ONE, delete the rest
   - "I love it" + "This is amazing" + "So good" → Keep the strongest, delete others
   - Multiple price reactions: "300 dollars?!" + "That's expensive" → Keep one

3. **REDUNDANT INFORMATION**: Same fact stated multiple times
   - "It weighs 45 pounds" + "45 pounds!" → Keep the one with more context

WHAT TO KEEP:
- Sentences that add NEW information (even if same topic)
- The STRONGEST/BEST version of each sentiment
- Context-setting sentences
- Transitional sentences that help flow

PICKING WHICH TO KEEP:
- Keep the most complete/eloquent version
- Keep the one with more context around it
- Keep earlier occurrences if quality is equal (maintains flow)

Be moderately aggressive - viewers don't want to hear "crazy" 5 times in 30 seconds.`;

  const userPrompt = `Here is the ordered script to polish:

${sentenceContext}

Find REDUNDANT sentences to delete:
1. Literal duplicates (same sentence twice)
2. Sentiment duplicates (multiple "crazy!", "insane!", "amazing!" reactions)
3. Redundant information (same fact stated multiple times)

For each group of redundant sentences, KEEP the best one and DELETE the others.

Return JSON:
{
  "sentencesToDelete": [
    {
      "sentenceId": "${sentences[0]?.id || 'sentence-id'}",
      "reason": "Redundant with [other sentence] - [why it's redundant]"
    }
  ],
  "deduplicationReasoning": "Summary of redundancies found and what was kept"
}

If the script is tight with no redundancy:
{
  "sentencesToDelete": [],
  "deduplicationReasoning": "No redundancy found - script is concise"
}

Use the EXACT sentence IDs shown above.
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
  console.log("[PASS 4] FULL RAW RESPONSE:");
  console.log("-".repeat(80));
  console.log(responseText);
  console.log("-".repeat(80));

  let result = {
    sentencesToDelete: [] as Array<{ sentenceId: string; reason: string }>,
    deduplicationReasoning: "",
  };

  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      result = {
        sentencesToDelete: parsed.sentencesToDelete || [],
        deduplicationReasoning: parsed.deduplicationReasoning || "",
      };
    }
  } catch (parseError) {
    console.error("[Pass 4] Failed to parse:", parseError);
    // Fallback: no deletions
  }

  // Validate sentence IDs exist
  const validSentenceIds = new Set(sentences.map(s => s.id));
  result.sentencesToDelete = result.sentencesToDelete.filter(d => {
    if (!validSentenceIds.has(d.sentenceId)) {
      console.warn(`[Pass 4] Invalid sentence ID: ${d.sentenceId}`);
      return false;
    }
    return true;
  });

  console.log("\n[PASS 4] PARSED RESULT:");
  console.log(`Sentences to delete (${result.sentencesToDelete.length}):`);
  result.sentencesToDelete.forEach((d, i) => {
    const sentence = sentences.find(s => s.id === d.sentenceId);
    console.log(`  ${i + 1}. ${d.sentenceId}: "${sentence?.text.substring(0, 40)}..." - ${d.reason}`);
  });
  console.log(`Reasoning: "${result.deduplicationReasoning}"`);
  console.log("=".repeat(80) + "\n");

  return result;
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { clips, sentences, pass, understanding } = body as {
      clips?: ClipTranscript[];
      sentences?: SentenceData[];
      pass?: number;
      understanding?: string;
    };

    console.log("\n" + "#".repeat(80));
    console.log(`[ANALYZE-CUTS API] INCOMING REQUEST - Pass ${pass || "legacy"}`);
    console.log("#".repeat(80));
    console.log(`Clips: ${clips?.length || 0}`);
    console.log(`Sentences: ${sentences?.length || 0}`);
    if (understanding) {
      console.log(`Understanding context: "${understanding.substring(0, 100)}..."`);
    }

    // Route to appropriate pass
    switch (pass) {
      case 1: {
        if (!clips || clips.length === 0) {
          return Response.json({ actions: [], message: "No clips to analyze" });
        }
        const result = await runPass1(clips);
        return Response.json({
          success: true,
          pass: 1,
          ...result,
        });
      }

      case 2: {
        // Pass 2 can now work with sentences for fine-grained ordering
        const result = await runPass2(clips || [], understanding || "", sentences);
        return Response.json({
          success: true,
          pass: 2,
          ...result,
        });
      }

      case 3: {
        if (!clips || clips.length === 0) {
          return Response.json({ actions: [], message: "No clips to analyze" });
        }
        const result = await runPass3(clips);
        return Response.json({
          success: true,
          pass: 3,
          ...result,
        });
      }

      case 4: {
        // Pass 4: Semantic deduplication at sentence level
        if (!sentences || sentences.length === 0) {
          return Response.json({
            success: true,
            pass: 4,
            sentencesToDelete: [],
            deduplicationReasoning: "No sentences provided",
          });
        }
        const result = await runPass4(sentences);
        return Response.json({
          success: true,
          pass: 4,
          ...result,
        });
      }

      default: {
        // Legacy: run all passes in sequence (for backward compatibility)
        console.log("[Analyze Cuts] Running legacy single-call mode");

        if (!clips || clips.length === 0) {
          return Response.json({ actions: [], message: "No clips to analyze" });
        }

        // Pass 1
        const pass1Result = await runPass1(clips);

        // Filter to unique clips for Pass 2
        const uniqueClips = clips.filter(c => pass1Result.uniqueClipIds.includes(c.clipId));

        // Pass 2 (clip-level for legacy mode)
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
