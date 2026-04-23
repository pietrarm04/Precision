import { readFile, readdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";

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
    return NextResponse.json({ files: sampleFiles });
  } catch {
    if (requestedName) {
      return NextResponse.json({ message: "Nao foi possivel carregar o arquivo de exemplo." }, { status: 404 });
    }
    return NextResponse.json({ files: [] }, { status: 200 });
  }
}
