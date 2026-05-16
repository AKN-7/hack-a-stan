"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

/** Stable pseudo-duration for decorative badges (avoids SSR/client Math.random mismatch). */
function durationBadgeSeconds(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = Math.imul(31, hash) + seed.charCodeAt(i);
    hash |= 0;
  }
  return 15 + (Math.abs(hash) % 60);
}

export const ThreeDMarquee = ({
  images,
  className,
}: {
  images: string[];
  className?: string;
}) => {
  // Split the images array into 4 equal parts
  const chunkSize = Math.ceil(images.length / 4);
  const chunks = Array.from({ length: 4 }, (_, colIndex) => {
    const start = colIndex * chunkSize;
    return images.slice(start, start + chunkSize);
  });

  return (
    <div
      className={cn(
        "w-full h-[400px] overflow-hidden",
        className
      )}
    >
      <div className="flex size-full items-center justify-center">
        <div className="w-[100vw] h-[800px] shrink-0 scale-[40%] sm:scale-[50%] lg:scale-[60%]">
          <div
            style={{
              transform: "rotateX(55deg) rotateY(0deg) rotateZ(-45deg)",
            }}
            className="relative top-[80%] right-[85%] grid size-full origin-top-left grid-cols-4 gap-8 transform-3d"
          >
            {chunks.map((subarray, colIndex) => {
              // Different movement patterns for each column
              const movements = [
                { y: 150, duration: 12 }, // Column 0: moves down, slower
                { y: -120, duration: 8 },  // Column 1: moves up, faster
                { y: 180, duration: 15 },   // Column 2: moves down, slowest
                { y: -100, duration: 10 }, // Column 3: moves up, medium
              ];
              const movement = movements[colIndex % 4];
              
              return (
              <motion.div
                animate={{ y: movement.y }}
                transition={{
                  duration: movement.duration,
                  repeat: Infinity,
                  repeatType: "reverse",
                }}
                key={colIndex + "marquee"}
                className="flex flex-col items-start gap-8"
              >
                <GridLineVertical className="-left-4" offset="80px" />
                {subarray.map((image, imageIndex) => (
                  <div className="relative" key={imageIndex + image}>
                    <GridLineHorizontal className="-top-4" offset="20px" />
                    <div className="relative">
                      <motion.img
                        whileHover={{ y: -10 }}
                        transition={{
                          duration: 0.3,
                          ease: "easeInOut",
                        }}
                        src={image}
                        alt={`Image ${imageIndex + 1}`}
                        className="aspect-[9/16] rounded-lg object-cover ring ring-border hover:shadow-2xl"
                        width={360}
                        height={640}
                      />
                      {/* Video play button overlay */}
                      <div className="absolute inset-0 flex items-center justify-center opacity-80">
                        <div className="w-8 h-8 bg-white/90 rounded-full flex items-center justify-center shadow-lg">
                          <div className="w-0 h-0 border-l-[6px] border-l-black border-y-[4px] border-y-transparent ml-1" />
                        </div>
                      </div>
                      {/* Duration badge */}
                      <div className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded">
                        {durationBadgeSeconds(`${colIndex}-${imageIndex}-${image}`)}s
                      </div>
                    </div>
                  </div>
                ))}
              </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

const GridLineHorizontal = ({
  className,
  offset,
}: {
  className?: string;
  offset?: string;
}) => {
  return (
    <div
      style={{
        "--background": "#F8F7F4",
        "--color": "rgba(0, 0, 0, 0.15)",
        "--height": "1px",
        "--width": "5px",
        "--fade-stop": "90%",
        "--offset": offset || "200px",
        "--color-dark": "rgba(255, 255, 255, 0.2)",
        maskComposite: "exclude",
      } as React.CSSProperties}
      className={cn(
        "absolute left-[calc(var(--offset)/2*-1)] h-[var(--height)] w-[calc(100%+var(--offset))]",
        "bg-[linear-gradient(to_right,var(--color),var(--color)_50%,transparent_0,transparent)]",
        "[background-size:var(--width)_var(--height)]",
        "[mask:linear-gradient(to_left,var(--background)_var(--fade-stop),transparent),_linear-gradient(to_right,var(--background)_var(--fade-stop),transparent),_linear-gradient(black,black)]",
        "[mask-composite:exclude]",
        "z-30",
        "dark:bg-[linear-gradient(to_right,var(--color-dark),var(--color-dark)_50%,transparent_0,transparent)]",
        className
      )}
    />
  );
};

const GridLineVertical = ({
  className,
  offset,
}: {
  className?: string;
  offset?: string;
}) => {
  return (
    <div
      style={{
        "--background": "#F8F7F4",
        "--color": "rgba(0, 0, 0, 0.15)",
        "--height": "5px",
        "--width": "1px",
        "--fade-stop": "90%",
        "--offset": offset || "150px",
        "--color-dark": "rgba(255, 255, 255, 0.2)",
        maskComposite: "exclude",
      } as React.CSSProperties}
      className={cn(
        "absolute top-[calc(var(--offset)/2*-1)] h-[calc(100%+var(--offset))] w-[var(--width)]",
        "bg-[linear-gradient(to_bottom,var(--color),var(--color)_50%,transparent_0,transparent)]",
        "[background-size:var(--width)_var(--height)]",
        "[mask:linear-gradient(to_top,var(--background)_var(--fade-stop),transparent),_linear-gradient(to_bottom,var(--background)_var(--fade-stop),transparent),_linear-gradient(black,black)]",
        "[mask-composite:exclude]",
        "z-30",
        "dark:bg-[linear-gradient(to_bottom,var(--color-dark),var(--color-dark)_50%,transparent_0,transparent)]",
        className
      )}
    />
  );
};
