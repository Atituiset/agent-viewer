import { NextResponse } from "next/server";
import { listClaudeSessionsAll } from "@/lib/claude";

export async function GET() {
  try {
    const sessions = listClaudeSessionsAll();
    return NextResponse.json({ sessions });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
