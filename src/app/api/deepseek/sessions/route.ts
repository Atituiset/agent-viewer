import { NextResponse } from "next/server";
import { listDeepSeekSessions } from "@/lib/deepseek";

export async function GET() {
  try {
    const sessions = listDeepSeekSessions();
    return NextResponse.json({ sessions });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
