import { NextRequest, NextResponse } from "next/server";
import { readCodexSession } from "@/lib/codex";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  try {
    const messages = readCodexSession(id);
    return NextResponse.json({ messages });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
