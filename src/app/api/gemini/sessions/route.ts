import { NextResponse } from "next/server";
import { listGeminiSessions } from "@/lib/gemini";

export async function GET() {
  try {
    const sessions = listGeminiSessions();
    return NextResponse.json({ sessions });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
