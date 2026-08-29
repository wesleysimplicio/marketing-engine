import { ingestReference, type ReferenceKind } from "../reference/ingest";

function flag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

export async function cliEntry(argv: string[]): Promise<void> {
  const subcommand = argv[0] ?? "ingest";
  if (subcommand !== "ingest") throw new Error("usage: reference ingest --source <url-or-file> [--transcript <text>]");
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
