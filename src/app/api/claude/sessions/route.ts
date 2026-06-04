import { NextRequest, NextResponse } from "next/server";
import { readClaudeSession } from "@/lib/claude";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const projectPath = searchParams.get("project");
  const sessionId = searchParams.get("session");

  if (!projectPath || !sessionId) {
    return NextResponse.json({ error: "Missing project or session param" }, { status: 400 });
  }

  try {
    const messages = readClaudeSession(projectPath, sessionId);
    return NextResponse.json({ messages });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
