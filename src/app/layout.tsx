import type { Metadata } from "next";
import "./globals.css";
import "highlight.js/styles/github-dark.css";

export const metadata: Metadata = {
  title: "Agent Viewer",
  description: "View Claude Code & OpenCode sessions",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="h-full flex flex-col bg-[var(--background)] text-[var(--foreground)] font-sans">{children}</body>
    </html>
  );
}
