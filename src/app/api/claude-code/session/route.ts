import { NextRequest, NextResponse } from "next/server";
import { readClaudeSession } from "@/lib/claude";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const id = searchParams.get("id");
  const projectPath = searchParams.get("projectPath");

  if (!id || !projectPath) {
    return NextResponse.json({ error: "Missing id or projectPath" }, { status: 400 });
  }

  try {
    const messages = readClaudeSession(projectPath, id);
    return NextResponse.json({ messages });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
