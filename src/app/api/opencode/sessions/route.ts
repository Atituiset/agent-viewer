import { NextResponse } from "next/server";
import { listOpenCodeSessions } from "@/lib/opencode";

export async function GET() {
  try {
    const sessions = listOpenCodeSessions();
    return NextResponse.json({ sessions });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
