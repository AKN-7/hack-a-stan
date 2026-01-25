import { Geist_Mono, Geist } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { baseUrl, createMetadata } from "@/utils/metadata";
import {
  StoreInitializer,
  BackgroundUploadRunner
} from "@/components/store-initializer";
import { QueryProvider } from "@/components/query-provider";
import { Analytics } from "@vercel/analytics/react";
import { Outfit, Sora } from "next/font/google";

import "./globals.css";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"]
});

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"]
});

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"]
});

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

export const metadata = createMetadata({
  title: {
    template: "%s | Distill",
    default: "Distill"
  },
  description: "AI Video generator for the next gen web.",
  metadataBase: baseUrl
});

// Mobile-optimized viewport settings
export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistMono.variable} ${geist.variable} ${outfit.variable} ${sora.variable} antialiased dark font-sans bg-muted`}
      >
        <QueryProvider>
          {children}
          <StoreInitializer />
          <BackgroundUploadRunner />
          <Toaster />
        </QueryProvider>
        <Analytics />
      </body>
    </html>
  );
}
