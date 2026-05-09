import type { Metadata } from "next";
import { Inter, Outfit } from "next/font/google";
import { FluidCursor, NeuralBackground } from "@/components/interactive";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const outfit = Outfit({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-outfit",
});

export const metadata: Metadata = {
  title: "SmartPrep AI",
  description: "AI-powered interview coaching platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${outfit.variable}`}>
      <head>
        {/* face-api.js for video proctoring face detection */}
        <script async src="https://cdn.jsdelivr.net/npm/face-api.js@0.20.0/dist/face-api.min.js"></script>
      </head>
      <body>
        <NeuralBackground className="z-0" maskSize={460} opacity={0.95} />
        <FluidCursor
          snapSelector='a, button, [role="button"], input, textarea, select, [data-cursor-snap="true"]'
          ringClassName="border-blue-300/25 bg-blue-500/10"
          dotClassName="h-3 w-3 bg-blue-400"
        />
        {children}
      </body>
    </html>
  );
}
