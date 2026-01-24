import useLayoutStore from "../store/use-layout-store";
import { Transitions } from "./transitions";
import { Transcript } from "./transcript";
import { useIsLargeScreen } from "@/hooks/use-media-query";
import { Uploads } from "./uploads";
import { Chat } from "./chat";

const ActiveMenuItem = () => {
  const { activeMenuItem } = useLayoutStore();

  if (activeMenuItem === "chat") {
    return <Chat />;
  }
  if (activeMenuItem === "transitions") {
    return <Transitions />;
  }
  if (activeMenuItem === "transcript") {
    return <Transcript />;
  }
  if (activeMenuItem === "uploads") {
    return <Uploads />;
  }

  return null;
};

export const MenuItem = () => {
  const isLargeScreen = useIsLargeScreen();

  return (
    <div className={`${isLargeScreen ? "w-[300px]" : "w-full"} flex-1 flex`}>
      <ActiveMenuItem />
    </div>
  );
};
