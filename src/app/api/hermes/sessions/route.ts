import { NextResponse } from "next/server";
import { listHermesSessions } from "@/lib/hermes";

export async function GET() {
  try {
    const sessions = listHermesSessions();
    return NextResponse.json({ sessions });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
