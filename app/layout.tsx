import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}