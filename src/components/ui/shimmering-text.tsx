"use client";

import { motion, useInView } from "framer-motion";
import { useRef, useMemo } from "react";
import { cn } from "@/lib/utils";

interface ShimmeringTextProps {
  text: string;
  duration?: number;
  delay?: number;
  repeat?: boolean;
  repeatDelay?: number;
  className?: string;
  startOnView?: boolean;
  once?: boolean;
  spread?: number;
  color?: string;
  shimmerColor?: string;
}

export function ShimmeringText({
  text,
  duration = 2,
  delay = 0,
  repeat = true,
  repeatDelay = 0.5,
  className,
  startOnView = true,
  once = false,
  spread = 2,
  color = "currentColor",
  shimmerColor = "var(--primary)",
}: ShimmeringTextProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once });

  const shouldAnimate = startOnView ? isInView : true;

  const dynamicSpread = useMemo(() => {
    return Math.min(text.length * spread, 100);
  }, [text.length, spread]);

  return (
    <motion.span
      ref={ref}
      className={cn("inline-block", className)}
      style={{
        background: `linear-gradient(
          90deg,
          ${color} 0%,
          ${color} 40%,
          ${shimmerColor} 50%,
          ${color} 60%,
          ${color} 100%
        )`,
        backgroundSize: `${dynamicSpread * 2}% 100%`,
        backgroundClip: "text",
        WebkitBackgroundClip: "text",
        color: "transparent",
      }}
      initial={{ backgroundPosition: "100% 0" }}
      animate={
        shouldAnimate
          ? { backgroundPosition: ["-100% 0", "200% 0"] }
          : { backgroundPosition: "100% 0" }
      }
      transition={{
        duration,
        delay,
        repeat: repeat ? Infinity : 0,
        repeatDelay,
        ease: "linear",
      }}
    >
      {text}
    </motion.span>
  );
}
