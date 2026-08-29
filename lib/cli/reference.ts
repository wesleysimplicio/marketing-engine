import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ingestReference, type ReferenceKind, type ReferenceSource } from "../reference/ingest";
import { readHbi } from "../formats/binary";
import { suppliedTranscriptProvider, TranscriptionRouter } from "../reference/transcription";

function flag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function rootPath(): string { return resolve(process.env.MARKETING_ENGINE_HOST_ROOT ?? process.cwd()); }

function sourceFromManifest(root: string, sourceId: string): ReferenceSource {
  const path = resolve(root, "data", "references", "manifest.hbi");
  if (!existsSync(path)) throw new Error(`reference source not found: ${sourceId}`);
  const manifest = readHbi<{ sources?: ReferenceSource[] }>(path);
  const source = manifest.sources?.find((item) => item.source_id === sourceId);
  if (!source) throw new Error(`reference source not found: ${sourceId}`);
  return source;
}

export async function cliEntry(argv: string[]): Promise<void> {
  const subcommand = argv[0] ?? "ingest";
  if (subcommand === "transcribe") {
    const root = rootPath();
    const suppliedText = flag(argv, "--text") ?? flag(argv, "--transcript");
    const sourceId = flag(argv, "--source-id");
    let source: ReferenceSource;
    if (sourceId) source = sourceFromManifest(root, sourceId);
    else {
      const value = flag(argv, "--source") ?? "supplied-transcript";
      const intake = await ingestReference({ value, supplied_transcript: suppliedText, language: flag(argv, "--language"), root, dry_run: !argv.includes("--live") });
      source = intake.source;
    }
    const result = await new TranscriptionRouter([suppliedTranscriptProvider()]).transcribe({
      source,
      text: suppliedText,
      language: flag(argv, "--language"),
      max_segment_chars: flag(argv, "--max-segment-chars") ? Number(flag(argv, "--max-segment-chars")) : undefined,
      root,
      dry_run: !argv.includes("--live"),
      allow_manual_review: argv.includes("--allow-manual-review"),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (["rejected", "deferred", "manual_review"].includes(result.status)) process.exitCode = 2;
    return;
  }
  if (subcommand !== "ingest") throw new Error("usage: reference ingest|transcribe --source <url-or-file> [--transcript <text>]");
  const value = flag(argv, "--source") ?? argv[1];
  if (!value) throw new Error("usage: reference ingest --source <url-or-file> [--transcript <text>]");
  const transcript = flag(argv, "--transcript");
  const result = await ingestReference({
    value,
    kind: flag(argv, "--kind") as ReferenceKind | undefined,
    supplied_transcript: transcript,
    language: flag(argv, "--language"),
    allow_hosts: argv.flatMap((item, index) => item === "--allow-host" && argv[index + 1] ? [argv[index + 1]!] : []),
    root: process.env.MARKETING_ENGINE_HOST_ROOT ?? process.cwd(),
    dry_run: !argv.includes("--live"),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.source.status === "rejected") process.exitCode = 2;
}

if (import.meta.url.endsWith("/reference.ts")) cliEntry(process.argv.slice(2)).catch((error) => { process.stderr.write(`${String(error)}\n`); process.exitCode = 1; });
