# 3D Marquee Moving Images - Complete Implementation Guide

Copy everything below into your project.

---

## Dependencies

```bash
npm install framer-motion clsx tailwind-merge
```

---

## 1. Utility Function (`lib/utils.ts`)

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

---

## 2. The 3D Marquee Component (`components/ui/3d-marquee.tsx`)

```tsx
"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

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
        <div className="w-[100vw] h-[800px] shrink-0 scale-50 sm:scale-75 lg:scale-100">
          <div
            style={{
              transform: "rotateX(55deg) rotateY(0deg) rotateZ(-45deg)",
            }}
            className="relative top-96 right-[50%] grid size-full origin-top-left grid-cols-4 gap-8 transform-3d"
          >
            {chunks.map((subarray, colIndex) => (
              <motion.div
                animate={{ y: colIndex % 2 === 0 ? 100 : -100 }}
                transition={{
                  duration: colIndex % 2 === 0 ? 10 : 15,
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
                        className="aspect-[970/700] rounded-lg object-cover ring ring-neutral-200 dark:ring-neutral-800 hover:shadow-2xl"
                        width={970}
                        height={700}
                      />
                      {/* Video play button overlay */}
                      <div className="absolute inset-0 flex items-center justify-center opacity-80">
                        <div className="w-8 h-8 bg-white/90 rounded-full flex items-center justify-center shadow-lg">
                          <div className="w-0 h-0 border-l-[6px] border-l-black border-y-[4px] border-y-transparent ml-1" />
                        </div>
                      </div>
                      {/* Duration badge */}
                      <div className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded">
                        {Math.floor(Math.random() * 60) + 15}s
                      </div>
                    </div>
                  </div>
                ))}
              </motion.div>
            ))}
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
        "--background": "#ffffff",
        "--color": "rgba(0, 0, 0, 0.2)",
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
        "--background": "#ffffff",
        "--color": "rgba(0, 0, 0, 0.2)",
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
```

---

## 3. Required CSS (add to `globals.css`)

```css
@layer utilities {
  .transform-3d {
    transform-style: preserve-3d;
  }

  .perspective-1000 {
    perspective: 1000px;
  }
}
```

---

## 4. Usage Example

```tsx
"use client";

import { ThreeDMarquee } from "@/components/ui/3d-marquee";

const images = [
  "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=300&fit=crop",
  "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=400&h=300&fit=crop",
  "https://images.unsplash.com/photo-1507591064344-4c6ce005b128?w=400&h=300&fit=crop",
  "https://images.unsplash.com/photo-1494790108755-2616b612b890?w=400&h=300&fit=crop",
  "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&h=300&fit=crop",
  "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400&h=300&fit=crop",
  "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400&h=300&fit=crop",
  "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&h=300&fit=crop",
  "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400&h=300&fit=crop",
  "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400&h=300&fit=crop",
  "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=400&h=300&fit=crop",
  "https://images.unsplash.com/photo-1489424731084-a5d8b219a5bb?w=400&h=300&fit=crop",
  "https://images.unsplash.com/photo-1504593811423-6dd665756598?w=400&h=300&fit=crop",
  "https://images.unsplash.com/photo-1502823403499-6ccfcf4fb453?w=400&h=300&fit=crop",
  "https://images.unsplash.com/photo-1521119989659-a83eee488004?w=400&h=300&fit=crop",
  "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=400&h=300&fit=crop",
];

export default function MyPage() {
  return (
    <section className="relative min-h-screen overflow-hidden">
      {/* As a background */}
      <div className="absolute inset-0 pointer-events-none">
        <ThreeDMarquee
          images={images}
          className="h-full w-full opacity-10"
        />
      </div>

      {/* Your content */}
      <div className="relative z-10">
        <h1>Your Content</h1>
      </div>
    </section>
  );
}
```

---

## 5. File Structure

```
your-project/
├── lib/
│   └── utils.ts
├── components/
│   └── ui/
│       └── 3d-marquee.tsx
├── app/
│   ├── globals.css
│   └── page.tsx
└── package.json
```

---

## 6. Customization

### Animation Speed
```tsx
duration: colIndex % 2 === 0 ? 10 : 15  // seconds
```

### Movement Distance
```tsx
animate={{ y: colIndex % 2 === 0 ? 100 : -100 }}  // pixels
```

### 3D Angle
```tsx
transform: "rotateX(55deg) rotateY(0deg) rotateZ(-45deg)"
```

### Container Height
```tsx
<ThreeDMarquee images={images} className="h-[600px]" />
```

### Remove Video Overlays
Delete the play button div (lines 62-67) and duration badge div (lines 69-71) if you don't want them.

---

**Use 12-16 images minimum for best results (4 per column).**
