import { NextResponse } from "next/server";
import { createClient } from "@deepgram/sdk";

const deepgram = createClient(process.env.DEEPGRAM_API_KEY!);

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";

    let audioSource: { url: string } | { buffer: Buffer; mimetype: string };
    let clipId: string | undefined;

    // Handle JSON body with URL
    if (contentType.includes("application/json")) {
      const body = await request.json();
      const { url, clipId: cid } = body;

      if (!url) {
        return NextResponse.json(
          { message: "No URL provided" },
          { status: 400 }
        );
      }

      clipId = cid;
      audioSource = { url };

    } else {
      // Handle FormData with file
      const formData = await request.formData();
      const file = formData.get("audio") as File;
      clipId = formData.get("clipId") as string | undefined;

      if (!file) {
        return NextResponse.json(
          { message: "No audio file provided" },
          { status: 400 }
        );
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      audioSource = { buffer, mimetype: file.type };
    }

    // Transcribe using Deepgram Nova-2
    const options = {
      model: "nova-2",
      smart_format: true,
      utterances: true,
      punctuate: true,
      diarize: false,
      // Keywords boost recognition of specific terms
      keywords: [
        "Stan store:5",
        "Stan:3",
        "B-roll:3",
        "creator:2",
        "creators:2",
      ],
    };

    let result: any;
    let error: any;

    if ("url" in audioSource) {
      // URL-based transcription
      const response = await deepgram.listen.prerecorded.transcribeUrl(
        audioSource,
        options
      );
      result = response.result;
      error = response.error;
    } else {
      // File-based transcription
      const response = await deepgram.listen.prerecorded.transcribeFile(
        audioSource.buffer,
        options
      );
      result = response.result;
      error = response.error;
    }

    if (error) {
      console.error("Deepgram error:", error);
      return NextResponse.json(
        { message: "Transcription failed", error: String(error) },
        { status: 500 }
      );
    }

    // Extract words with timestamps
    const words = result.results?.channels?.[0]?.alternatives?.[0]?.words || [];
    const transcript = result.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";

    // Get duration from Deepgram metadata (in seconds)
    const durationSeconds = result.metadata?.duration || 0;
    const durationMs = Math.round(durationSeconds * 1000);

    // Transform to the format expected by the timeline
    const captions = words.map((word: any) => ({
      text: word.punctuated_word || word.word,
      startMs: Math.round(word.start * 1000),
      endMs: Math.round(word.end * 1000),
      timestampMs: Math.round(word.start * 1000),
      confidence: word.confidence,
      clipId,
    }));

    return NextResponse.json({
      text: transcript,
      captions,
      clipId,
      durationMs, // Duration of the media file
    }, { status: 200 });

  } catch (error: any) {
    console.error("Transcription error:", error);

    return NextResponse.json(
      { message: "Failed to transcribe audio", error: String(error) },
      { status: 500 }
    );
  }
}
