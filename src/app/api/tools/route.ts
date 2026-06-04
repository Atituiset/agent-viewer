import { NextRequest, NextResponse } from "next/server";
import { detectTools } from "@/lib/detect";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const machineId = searchParams.get("machineId") || "local";

  try {
    const homeDir = machineId === "local" || machineId.startsWith("local-")
      ? undefined
      : undefined;

    const tools = detectTools(homeDir);
    return NextResponse.json({ tools });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
