import type { Metadata } from "next";
import "./globals.css";

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
      <head>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css" />
      </head>
      <body className="h-full flex flex-col bg-[var(--background)] text-[var(--foreground)] font-sans">{children}</body>
    </html>
  );
}
