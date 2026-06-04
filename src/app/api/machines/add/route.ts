import { NextRequest, NextResponse } from "next/server";
import { addMachine } from "@/lib/machines";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, host, user, port, sshKey, password, authMethod } = body;
    if (!host || !user) {
      return NextResponse.json({ error: "Missing host or user" }, { status: 400 });
    }
    const machine = addMachine({
      name: name || host,
      host,
      user,
      port: port || 22,
      type: "ssh",
      authMethod: authMethod || (sshKey ? "sshKey" : "password"),
      sshKey: sshKey || undefined,
      password: password || undefined,
    });
    return NextResponse.json({ machine });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
