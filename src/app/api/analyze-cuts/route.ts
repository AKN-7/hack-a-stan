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

CRITICAL: DETECT DUPLICATE TAKES
Creators often record the same section multiple times. Look for:
- Multiple "intro" clips ("Hi, I'm...", "I'm a founder at...")
- Same topic explained with slightly different wording
- Re-recorded sections where the creator started over

When you find duplicate takes of the SAME CONTENT:
1. Pick the BEST take (cleaner delivery, more confident, better phrasing)
2. PUT THE WORSE TAKE(S) IN clipsToRemove — do NOT keep both
3. "Slightly different wording" does NOT mean "unique content" — it means re-take

WHAT COUNTS AS DUPLICATE TAKES (REMOVE THE WORSE ONE):
- Two clips both introducing themselves ("I'm X at Y company")
- Two clips explaining the same concept with minor word differences
- Two clips that serve the same PURPOSE even if words differ slightly

WHAT COUNTS AS UNIQUE CONTENT (KEEP BOTH):
- Different topics, examples, or stories
- Additional details not covered in other clips
- Genuinely new information

PHILOSOPHY: Keep unique content, remove redundant takes. A final video should NOT have the creator introducing themselves twice or explaining the same thing twice with different words.

ORDERING STRATEGY:
- **Hook** → FIRST (the most compelling/attention-grabbing statement - numbers, bold claims)
- **Intro** (greeting/name) → After hook or at start if no hook
- **Body content** → Logical flow, building on previous points
- **Examples/Stories** → Weave in for engagement
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

**EMPHASIS MOMENTS** (for zoom effects):
Identify 2-4 key moments where a slow zoom would add impact:
- Numbers/statistics ("300 million", "10x growth")
- Bold claims or statements
- Emotional peaks
- Key revelations or "aha" moments
- Call-to-actions
For each, provide the word IDs that mark the START of the emphasis moment.

Return JSON:
{
  "suggestedOrder": ["clipId1", "clipId2"],  // Order of ALL clips to KEEP
  "clipsToRemove": [
    {
      "clipId": "clipId3",
      "clipIndex": 3,
      "reason": "Duplicate intro - better delivery in Clip 1"
    }
  ],
  "wordCuts": [
    {
      "clipId": "...",
      "wordIds": ["id1", "id2", "id3"],  // MUST include actual word IDs from the input
      "reason": "Stammering - repeated phrase",
      "text": "I built the tool"
    }
  ],
  "emphasisPoints": [
    {
      "clipId": "...",
      "wordId": "id1",  // The word where zoom should START
      "reason": "Key statistic - high impact moment",
      "text": "300 million dollars"
    }
  ],
  "textHook": "The compelling hook text for the first 4 seconds",
  "reasoning": "Brief explanation of editing decisions"
}`;

    const userPrompt = `Analyze these ${clips.length} clips to create ONE polished video.

CLIP TRANSCRIPTS:
${transcriptContext}

WORD IDS (use these exact IDs in wordCuts):
${wordsContext}

DUPLICATE DETECTION (CRITICAL):
1. First, identify clips that cover the SAME content (intros, same explanation, re-takes)
2. For each group of duplicates, pick the BEST one and put others in clipsToRemove
3. "I'm a founder at X" and "I'm founding engineer at X" = SAME INTRO, keep only one
4. Two explanations of the same thing with different words = DUPLICATE, keep the better one

WHAT TO KEEP:
- ONE intro (the best take)
- Each UNIQUE topic/example/story (only once, best version)
- The hook/attention-grabber

WHAT TO REMOVE (clipsToRemove):
- Worse takes of the same intro
- Redundant explanations of the same content
- Re-recorded sections where another take is better

TECHNICAL NOTES:
- Use the actual clipId values (like "${clips[0]?.clipId}") not "clipId1"
- Use actual word IDs from above for wordCuts
- suggestedOrder should only include clips you're KEEPING (not in clipsToRemove)

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
      clipsToRemove: [] as Array<{ clipId: string; clipIndex: number; reason: string }>,
      wordCuts: [] as Array<{ clipId: string; wordIds: string[]; reason: string; text: string }>,
      emphasisPoints: [] as Array<{ clipId: string; wordId: string; reason: string; text: string }>,
      textHook: "" as string,
      reasoning: "",
    };

    try {
      // Find JSON object in response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);

        // Handle clipsToRemove - could be array of strings (old format) or objects (new format)
        let clipsToRemove: Array<{ clipId: string; clipIndex: number; reason: string }> = [];
        if (Array.isArray(parsed.clipsToRemove)) {
          clipsToRemove = parsed.clipsToRemove.map((item: any, idx: number) => {
            if (typeof item === 'string') {
              // Old format - just clipId string
              return { clipId: item, clipIndex: idx + 1, reason: 'Duplicate take' };
            }
            // New format - object with clipId, clipIndex, reason
            return {
              clipId: item.clipId || item,
              clipIndex: item.clipIndex || idx + 1,
              reason: item.reason || 'Duplicate take',
            };
          });
        }

        result = {
          suggestedOrder: parsed.suggestedOrder || [],
          clipsToRemove,
          wordCuts: parsed.wordCuts || [],
          emphasisPoints: parsed.emphasisPoints || [],
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
      emphasisPointsCount: result.emphasisPoints.length,
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
