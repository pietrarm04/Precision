import { NextResponse } from "next/server";
import { z } from "zod";
import { appendDebugLog } from "@/lib/debugLog";

export const runtime = "nodejs";

const debugPayloadSchema = z.object({
  hypothesisId: z.string().min(1),
  location: z.string().min(1),
  message: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
  timestamp: z.number(),
});

export async function POST(request: Request) {
  try {
    const raw = await request.json();
    const payload = debugPayloadSchema.parse(raw);
    appendDebugLog(payload);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
