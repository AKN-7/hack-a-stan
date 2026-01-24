import { NextRequest } from "next/server";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const ANALYSIS_MODEL = "gemini-2.5-flash";

interface TextPlacement {
  position: {
    horizontal: "left" | "center" | "right";
    vertical: "top" | "middle" | "bottom";
    x: number; // percentage from left
    y: number; // percentage from top
  };
  styling: {
    color: string;
    backgroundColor?: string;
    fontSize: "small" | "medium" | "large" | "xlarge";
    fontWeight: "normal" | "bold";
    textShadow: boolean;
    textStroke: boolean;
  };
  reasoning: string;
}

interface AnalysisResult {
  success: boolean;
  placement?: TextPlacement;
  error?: string;
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const { frameBase64, text, style } = await request.json();

    if (!frameBase64) {
      return Response.json({ success: false, error: "Frame image is required" }, { status: 400 });
    }

    if (!text) {
      return Response.json({ success: false, error: "Text content is required" }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return Response.json({ success: false, error: "Gemini API key not configured" }, { status: 500 });
    }

    const analysisPrompt = `You are a professional video editor and motion graphics designer. Analyze this video frame and determine the OPTIMAL placement for text overlay.

TEXT TO ADD: "${text}"
STYLE HINT: ${style || "title/headline"}

Analyze the frame for:
1. **Subject positioning** - Where are faces, important objects, action happening?
2. **Visual weight** - Where are bright/dark areas, busy/clean areas?
3. **Color palette** - What colors dominate? What would contrast well?
4. **Composition** - Rule of thirds, leading lines, focal points

Based on your analysis, recommend:
- **Position**: Where the text won't cover important content but remains visible
- **Color**: What color will be readable against the background
- **Size**: Appropriate for the composition (small/medium/large/xlarge)
- **Effects**: Whether text shadow or stroke is needed for readability

Return ONLY a JSON object with this exact structure:
{
  "position": {
    "horizontal": "left" | "center" | "right",
    "vertical": "top" | "middle" | "bottom",
    "x": 50,
    "y": 15
  },
  "styling": {
    "color": "#FFFFFF",
    "backgroundColor": null,
    "fontSize": "large",
    "fontWeight": "bold",
    "textShadow": true,
    "textStroke": false
  },
  "reasoning": "Brief explanation of why this placement works"
}

IMPORTANT:
- x and y are percentages (0-100) from top-left
- Avoid placing text over faces or key subjects
- Prefer top or bottom thirds for titles
- Use high contrast colors for readability
- Add textShadow or textStroke if background is busy/varied

Return ONLY the JSON, no markdown code blocks.`;

    // Call Gemini API
    const url = `${GEMINI_API_BASE}/${ANALYSIS_MODEL}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            {
              inline_data: {
                mime_type: "image/png",
                data: frameBase64.replace(/^data:image\/\w+;base64,/, ""),
              },
            },
            { text: analysisPrompt },
          ],
        }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini API error:", errorText);
      return Response.json({ success: false, error: "Failed to analyze frame" }, { status: 500 });
    }

    const data = await response.json();

    // Extract text response
    let textResponse = "";
    const candidates = data.candidates || [];
    if (candidates.length > 0) {
      const content = candidates[0].content || {};
      for (const part of content.parts || []) {
        if (part.text) {
          textResponse = part.text;
          break;
        }
      }
    }

    if (!textResponse) {
      return Response.json({ success: false, error: "No response from Gemini" }, { status: 500 });
    }

    // Parse JSON from response
    try {
      let jsonText = textResponse;
      if (textResponse.includes("```json")) {
        jsonText = textResponse.split("```json")[1].split("```")[0];
      } else if (textResponse.includes("```")) {
        jsonText = textResponse.split("```")[1].split("```")[0];
      }

      const placement = JSON.parse(jsonText.trim()) as TextPlacement;
      return Response.json({ success: true, placement });
    } catch {
      console.error("Failed to parse Gemini response:", textResponse);
      return Response.json({
        success: false,
        error: "Failed to parse placement recommendations",
        raw: textResponse,
      }, { status: 500 });
    }
  } catch (error) {
    console.error("Analyze frame error:", error);
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 });
  }
}
