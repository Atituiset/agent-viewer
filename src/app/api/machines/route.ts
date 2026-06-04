import { NextResponse } from "next/server";
import { loadMachines } from "@/lib/machines";

export async function GET() {
  try {
    const machines = loadMachines();
    return NextResponse.json({ machines });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
