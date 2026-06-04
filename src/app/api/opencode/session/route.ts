import { NextRequest, NextResponse } from "next/server";
import { readOpenCodeSession, getOpenCodeSessionMeta } from "@/lib/opencode";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const sessionId = searchParams.get("id");

  if (!sessionId) {
    return NextResponse.json({ error: "Missing id param" }, { status: 400 });
  }

  try {
    const meta = getOpenCodeSessionMeta(sessionId);
    const messages = readOpenCodeSession(sessionId);
    return NextResponse.json({ meta, messages });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
