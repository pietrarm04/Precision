import { readFile, readdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { appendDebugLog } from "@/lib/debugLog";

export const runtime = "nodejs";

const ALLOWED_EXTENSIONS = new Set([".csv", ".xlsx", ".xls"]);

const querySchema = z.object({
  name: z.string().min(1).optional(),
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const requestedName = searchParams.get("name") ?? undefined;
  try {
    const parsed = querySchema.parse({ name: requestedName });
    if (parsed.name) {
      const safeName = basename(parsed.name);
      const ext = extname(safeName).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        return NextResponse.json({ message: "Extensao de arquivo nao suportada." }, { status: 400 });
      }
      const filePath = join(process.cwd(), "samples", safeName);
      const buffer = await readFile(filePath);
      appendDebugLog({
        hypothesisId: "F",
        location: "app/api/sample-files/route.ts:GET-file-success",
        message: "Sample file loaded for browser-restricted environment",
        data: {
          safeName,
          bytes: buffer.byteLength,
        },
        timestamp: Date.now(),
      });
      return NextResponse.json({
        fileName: safeName,
        mimeType:
          ext === ".csv"
            ? "text/csv"
            : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        fileBase64: buffer.toString("base64"),
      });
    }
    const samplesDir = join(process.cwd(), "samples");
    const files = await readdir(samplesDir, { withFileTypes: true });
    const sampleFiles = files
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => ALLOWED_EXTENSIONS.has(extname(name).toLowerCase()))
      .sort((a, b) => a.localeCompare(b));
    appendDebugLog({
      hypothesisId: "F",
      location: "app/api/sample-files/route.ts:GET-success",
      message: "Sample file list loaded",
      data: { count: sampleFiles.length },
      timestamp: Date.now(),
    });
    return NextResponse.json({ files: sampleFiles });
  } catch (error) {
    appendDebugLog({
      hypothesisId: "F",
      location: "app/api/sample-files/route.ts:GET-error",
      message: "Failed to list sample files",
      data: { error: error instanceof Error ? error.message : "unknown" },
      timestamp: Date.now(),
    });
    if (requestedName) {
      return NextResponse.json({ message: "Nao foi possivel carregar o arquivo de exemplo." }, { status: 404 });
    }
    return NextResponse.json({ files: [] }, { status: 200 });
  }
}
