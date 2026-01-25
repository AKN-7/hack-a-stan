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

CRITICAL: These clips are likely MULTIPLE TAKES of similar content. Your job is to:
1. Keep ONLY the best take of each piece of content
2. Remove ENTIRE clips that are worse versions of content in other clips
3. Fix any stammering/repetition within clips
4. Order clips for optimal narrative flow

ANALYSIS RULES:

**INTRO DETECTION**: Clips with "Hi", "Hey", "Hello", "I'm [name]" are intros → put FIRST

**DUPLICATE TAKES**: If multiple clips say essentially the same thing (e.g., introducing themselves or their job):
- Keep the SINGLE BEST version
- Mark ALL other versions' clips for REMOVAL in clipsToRemove

**STAMMERING/REPETITION**: "I built the tool I built the tool" → cut the FIRST occurrence's word IDs

**ORDERING**:
- Intro (greeting/name) → FIRST
- Body content → MIDDLE
- Outro (thanks/goodbye) → LAST

BE AGGRESSIVE - creators want tight, professional edits. When in doubt, CUT IT.

**TEXT HOOK**: Generate a compelling text hook for the first 4 seconds of the video.
- Find the MOST attention-grabbing statement (numbers, achievements, bold claims)
- Make it SHORT (5-10 words max)
- Make it scroll-stopping (would make someone stop scrolling on TikTok/Instagram)
- Examples: "How I helped creators make $300M", "The tool that changed everything", "From zero to $1M in 6 months"

Return JSON:
{
  "suggestedOrder": ["clipId1", "clipId2"],  // Order of clips to KEEP (exclude removed clips)
  "clipsToRemove": ["clipId3", "clipId4"],   // Clips to DELETE entirely (duplicate takes)
  "wordCuts": [
    {
      "clipId": "...",
      "wordIds": ["id1", "id2", "id3"],  // MUST include actual word IDs from the input
      "reason": "Stammering - repeated phrase",
      "text": "I built the tool"
    }
  ],
  "textHook": "The compelling hook text for the first 4 seconds",
  "reasoning": "Brief explanation"
}`;

    const userPrompt = `Analyze these ${clips.length} clips to create ONE polished video.

CLIP TRANSCRIPTS:
${transcriptContext}

WORD IDS (use these exact IDs in wordCuts):
${wordsContext}

IMPORTANT:
- Clips 1-5 might all be takes of the SAME intro content - keep only ONE best take
- If you see "I built X I built X" - that's stammering, cut the first occurrence
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
