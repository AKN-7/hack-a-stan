import { IAudio } from "@designcombo/types";
import { BaseSequence, SequenceItemOptions } from "../base-sequence";
import { Audio as RemotionAudio } from "remotion";

export default function Audio({
  item,
  options
}: {
  item: IAudio;
  options: SequenceItemOptions;
}) {
  const { fps } = options;
  const { details } = item;
  const playbackRate = item.playbackRate || 1;
  const children = (
    <RemotionAudio
      startFrom={Math.floor((item.trim?.from! / 1000) * fps)}
      endAt={Math.ceil((item.trim?.to! / 1000) * fps) || 1}
      playbackRate={playbackRate}
      src={details.src}
      volume={details.volume! / 100}
    />
  );
  return BaseSequence({ item, options, children });
}
