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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { clips } = body as { clips: ClipTranscript[] };

    if (!clips || clips.length === 0) {
      return Response.json({ actions: [], message: "No clips to analyze" });
    }

    // Build comprehensive transcript context for Claude
    const transcriptContext = clips.map(clip =>
      `=== CLIP ${clip.clipIndex} (ID: ${clip.clipId}) ===\n${clip.text}`
    ).join("\n\n");

    const wordsContext = clips.map(clip =>
      `CLIP ${clip.clipIndex} (${clip.clipId}) WORDS:\n${clip.words.map(w => `  "${w.text}" [${w.id}]`).join("\n")}`
    ).join("\n\n---\n\n");

    const systemPrompt = `You are an expert video editor creating ONE polished video from multiple raw clips.

PHILOSOPHY: Every clip has value. Your job is to SALVAGE and STITCH content intelligently, not just delete. Deleting a clip should be the LAST resort when it truly adds nothing.

CRITICAL ANALYSIS APPROACH:
1. NEVER delete a clip just because another clip covers similar ground - instead, find what's UNIQUE in each clip
2. Look for complementary content: different examples, different phrasings, additional details
3. Stitch together the BEST PARTS from multiple takes - don't just pick one and discard the rest
4. Use wordCuts surgically to extract good segments and remove bad ones within each clip

WHAT TO SALVAGE (use wordCuts to extract these from "bad" clips):
- Unique examples or stories not in other clips
- Better explanations of specific points
- Stronger emotional moments or emphasis
- Good one-liners or quotable moments
- Additional context that enriches the narrative

WHEN TO ACTUALLY REMOVE A CLIP (clipsToRemove):
- The clip is 100% duplicate with nothing unique (identical words, same delivery)
- The clip is completely unusable (all filler, all stammering, makes no sense)
- The clip contradicts other clips and is clearly the wrong version

ORDERING STRATEGY:
- **Intro** (greeting/name) → FIRST
- **Hook/Strongest Point** → Consider moving the most compelling moment near the start
- **Body content** → Logical flow, building on previous points
- **Examples/Stories** → Weave in throughout for engagement
- **Outro** (thanks/goodbye) → LAST

WORD CUTS (be surgical):
- Stammering: "I built the tool I built the tool" → cut the FIRST occurrence
- False starts: "So basically, what I mean is, so basically" → keep only the final clean version
- Filler gaps: Long "umm" or pauses → cut them
- Repetitive transitions: Multiple "so" or "basically" in a row

**TEXT HOOK**: Generate a compelling text hook for the first 4 seconds:
- Find the MOST attention-grabbing statement (numbers, achievements, bold claims)
- Make it SHORT (5-10 words max)
- Make it scroll-stopping (would make someone stop scrolling on TikTok/Instagram)
- Examples: "How I helped creators make $300M", "The tool that changed everything", "From zero to $1M in 6 months"

Return JSON:
{
  "suggestedOrder": ["clipId1", "clipId2"],  // Order of ALL clips to KEEP (try to keep most clips!)
  "clipsToRemove": ["clipId3"],   // ONLY clips that are truly 100% unusable - be conservative here
  "wordCuts": [
    {
      "clipId": "...",
      "wordIds": ["id1", "id2", "id3"],  // MUST include actual word IDs from the input
      "reason": "Stammering - repeated phrase",
      "text": "I built the tool"
    }
  ],
  "textHook": "The compelling hook text for the first 4 seconds",
  "reasoning": "Brief explanation of how you salvaged content from each clip"
}`;

    const userPrompt = `Analyze these ${clips.length} clips to create ONE polished video.

CLIP TRANSCRIPTS:
${transcriptContext}

WORD IDS (use these exact IDs in wordCuts):
${wordsContext}

SMART EDITING APPROACH:
- DON'T just delete clips because they overlap - find what's UNIQUE in each one
- Multiple intro takes? Pick the best ONE for intro, but check if others have unique content worth keeping later
- Use wordCuts to surgically extract good segments from "weaker" clips
- STITCH content: Clip 2 might have a better example, Clip 3 might have better energy on one sentence
- Only put a clip in clipsToRemove if it's truly 100% duplicate with zero unique value

TECHNICAL NOTES:
- If you see "I built X I built X" - that's stammering, cut the first occurrence using wordCuts
- Greeting/intro clips ("Hi, I'm...") should be FIRST in suggestedOrder
- Use the actual clipId values (like "${clips[0]?.clipId}") not "clipId1"
- Use actual word IDs from above for wordCuts

Return ONLY valid JSON.`;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    // Extract the response text
    const responseText = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map(block => block.text)
      .join("");

    console.log("[AI Analysis] Raw response:", responseText.substring(0, 500));

    // Parse the JSON response
    let result = {
      suggestedOrder: [] as string[],
      clipsToRemove: [] as string[],
      wordCuts: [] as Array<{ clipId: string; wordIds: string[]; reason: string; text: string }>,
      textHook: "" as string,
      reasoning: "",
    };

    try {
      // Find JSON object in response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        result = {
          suggestedOrder: parsed.suggestedOrder || [],
          clipsToRemove: parsed.clipsToRemove || [],
          wordCuts: parsed.wordCuts || [],
          textHook: parsed.textHook || "",
          reasoning: parsed.reasoning || "",
        };
      }
    } catch (parseError) {
      console.error("Failed to parse AI response:", parseError);
      console.log("Raw response:", responseText);
    }

    // Flatten all word IDs to delete
    const allWordIds = result.wordCuts.flatMap(cut => cut.wordIds);

    console.log("[AI Analysis] Results:", {
      suggestedOrder: result.suggestedOrder,
      clipsToRemove: result.clipsToRemove,
      wordCutsCount: result.wordCuts.length,
      totalWordsToDelete: allWordIds.length,
      textHook: result.textHook,
    });

    return Response.json({
      success: true,
      ...result,
      wordIdsToDelete: allWordIds,
      message: `AI analysis complete: ${result.clipsToRemove.length} clips to remove, ${result.wordCuts.length} sections to cut`,
    });

  } catch (error) {
    console.error("Analyze cuts error:", error);
    return Response.json(
      { error: "Failed to analyze transcript", details: String(error) },
      { status: 500 }
    );
  }
}
