import "./app/globals.css";
import { Composition, staticFile } from "remotion";
import {
  CaptionedVideo,
  calculateCaptionedVideoMetadata,
  captionedVideoSchema,
} from "./CaptionedVideo";
import {
  TranscriptVideo,
  calculateTranscriptVideoMetadata,
  transcriptVideoSchema,
} from "./TranscriptVideo";

// Each <Composition> is an entry in the sidebar!

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="CaptionedVideo"
        component={CaptionedVideo}
        calculateMetadata={calculateCaptionedVideoMetadata}
        schema={captionedVideoSchema}
        width={1080}
        height={1920}
        defaultProps={{
          src: staticFile("sample-video.mp4"),
        }}
      />
      <Composition
        id="TranscriptVideo"
        component={TranscriptVideo}
        calculateMetadata={calculateTranscriptVideoMetadata}
        schema={transcriptVideoSchema}
        width={1080}
        height={1920}
        defaultProps={{
          segments: [],
          durationMs: 1000,
          captions: [],
          textOverlays: [],
        }}
      />
    </>
  );
};
