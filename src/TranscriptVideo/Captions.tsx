import React from "react";
import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";

export interface Caption {
  text: string;
  startMs: number;
  endMs: number;
}

interface CaptionsProps {
  captions: Caption[];
}

const captionStyle: React.CSSProperties = {
  position: "absolute",
  bottom: 120,
  left: 0,
  right: 0,
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  padding: "0 40px",
};

const textStyle: React.CSSProperties = {
  fontFamily: "Arial, Helvetica, sans-serif",
  fontSize: 64,
  fontWeight: 900,
  color: "#FFFFFF",
  textAlign: "center",
  textTransform: "uppercase",
  textShadow: "-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000",
  maxWidth: "90%",
  wordWrap: "break-word",
};

/**
 * Simple caption renderer using system fonts.
 * No custom font loading required - works reliably in Lambda.
 */
export const Captions: React.FC<CaptionsProps> = ({ captions }) => {
  const { fps } = useVideoConfig();

  if (!captions || captions.length === 0) {
    return null;
  }

  return (
    <AbsoluteFill>
      {captions.map((caption, index) => {
        const startFrame = Math.floor((caption.startMs / 1000) * fps);
        const endFrame = Math.ceil((caption.endMs / 1000) * fps);
        const durationInFrames = Math.max(1, endFrame - startFrame);

        return (
          <Sequence
            key={`caption-${index}-${caption.startMs}`}
            from={startFrame}
            durationInFrames={durationInFrames}
          >
            <div style={captionStyle}>
              <span style={textStyle}>{caption.text}</span>
            </div>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

export default Captions;
