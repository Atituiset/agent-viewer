import { NextResponse } from "next/server";
import { listCodexSessions } from "@/lib/codex";

export async function GET() {
  try {
    const sessions = listCodexSessions();
    return NextResponse.json({ sessions });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
