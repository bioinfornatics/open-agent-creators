#!/usr/bin/env node
/**
 * Generate and serve a review page for eval results.
 *
 * Reads the workspace directory, discovers runs (directories with outputs/),
 * embeds all output data into a self-contained HTML page, and serves it via
 * a tiny HTTP server. Feedback auto-saves to feedback.json in the workspace.
 *
 * Usage:
 *   node generate_review.js <workspace-path> [--port PORT] [--skill-name NAME]
 *   node generate_review.js <workspace-path> --previous-feedback /path/to/old/feedback.json
 *
 * No dependencies beyond the Node stdlib are required.
 */
import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
  mkdirSync,
} from "node:fs";
import { join, relative, dirname, extname, resolve, basename } from "node:path";
import { parseArgs } from "node:util";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const HERE = dirname(new URL(import.meta.url).pathname);

const METADATA_FILES = new Set(["transcript.md", "user_notes.md", "metrics.json"]);

const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".json", ".csv", ".py", ".js", ".ts", ".tsx", ".jsx",
  ".yaml", ".yml", ".xml", ".html", ".css", ".sh", ".rb", ".go", ".rs",
  ".java", ".c", ".cpp", ".h", ".hpp", ".sql", ".r", ".toml",
]);

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"]);

const MIME_OVERRIDES: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html", ".htm": "text/html", ".css": "text/css",
  ".js": "text/javascript", ".json": "application/json", ".txt": "text/plain",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".pdf": "application/pdf",
};

function getMimeType(path: string): string {
  const ext = extname(path).toLowerCase();
  if (MIME_OVERRIDES[ext]) return MIME_OVERRIDES[ext];
  return MIME_TYPES[ext] || "application/octet-stream";
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

interface OutputFile {
  name: string;
  type: string;
  content?: string;
  mime?: string;
  data_uri?: string;
  data_b64?: string;
}

interface Run {
  id: string;
  prompt: string;
  eval_id: unknown;
  outputs: OutputFile[];
  grading: unknown;
}

function embedFile(path: string): OutputFile {
  const ext = extname(path).toLowerCase();
  const mime = getMimeType(path);
  const name = basename(path);

  if (TEXT_EXTENSIONS.has(ext)) {
    let content: string;
    try {
      content = readFileSync(path, "utf-8");
    } catch {
      content = "(Error reading file)";
    }
    return { name, type: "text", content };
  }
  if (IMAGE_EXTENSIONS.has(ext)) {
    try {
      const raw = readFileSync(path);
      return { name, type: "image", mime, data_uri: `data:${mime};base64,${raw.toString("base64")}` };
    } catch {
      return { name, type: "error", content: "(Error reading file)" };
    }
  }
  if (ext === ".pdf") {
    try {
      const raw = readFileSync(path);
      return { name, type: "pdf", data_uri: `data:${mime};base64,${raw.toString("base64")}` };
    } catch {
      return { name, type: "error", content: "(Error reading file)" };
    }
  }
  if (ext === ".xlsx") {
    try {
      const raw = readFileSync(path);
      return { name, type: "xlsx", data_b64: raw.toString("base64") };
    } catch {
      return { name, type: "error", content: "(Error reading file)" };
    }
  }
  try {
    const raw = readFileSync(path);
    return { name, type: "binary", mime, data_uri: `data:${mime};base64,${raw.toString("base64")}` };
  } catch {
    return { name, type: "error", content: "(Error reading file)" };
  }
}

function buildRun(root: string, runDir: string): Run | null {
  let prompt = "";
  let evalId: unknown = null;

  for (const candidate of [join(runDir, "eval_metadata.json"), join(dirname(runDir), "eval_metadata.json")]) {
    if (existsSync(candidate)) {
      try {
        const metadata = JSON.parse(readFileSync(candidate, "utf-8"));
        prompt = metadata.prompt ?? "";
        evalId = metadata.eval_id ?? null;
      } catch {
        // ignore malformed metadata
      }
      if (prompt) break;
    }
  }

  if (!prompt) {
    for (const candidate of [join(runDir, "transcript.md"), join(runDir, "outputs", "transcript.md")]) {
      if (existsSync(candidate)) {
        try {
          const text = readFileSync(candidate, "utf-8");
          const match = /## Eval Prompt\n\n([\s\S]*?)(?=\n##|$)/.exec(text);
          if (match) prompt = match[1].trim();
        } catch {
          // ignore
        }
        if (prompt) break;
      }
    }
  }

  if (!prompt) prompt = "(No prompt found)";

  const runId = relative(root, runDir).split(/[\\/]/).join("-");

  const outputsDir = join(runDir, "outputs");
  const outputFiles: OutputFile[] = [];
  if (isDir(outputsDir)) {
    for (const entry of readdirSync(outputsDir).sort()) {
      const filePath = join(outputsDir, entry);
      if (isFile(filePath) && !METADATA_FILES.has(entry)) {
        outputFiles.push(embedFile(filePath));
      }
    }
  }

  let grading: unknown = null;
  for (const candidate of [join(runDir, "grading.json"), join(dirname(runDir), "grading.json")]) {
    if (existsSync(candidate)) {
      try {
        grading = JSON.parse(readFileSync(candidate, "utf-8"));
      } catch {
        // ignore
      }
      if (grading) break;
    }
  }

  return { id: runId, prompt, eval_id: evalId, outputs: outputFiles, grading };
}

function findRunsRecursive(root: string, current: string, runs: Run[]): void {
  if (!isDir(current)) return;
  const outputsDir = join(current, "outputs");
  if (isDir(outputsDir)) {
    const run = buildRun(root, current);
    if (run) runs.push(run);
    return;
  }
  const skip = new Set(["node_modules", ".git", "__pycache__", "skill", "inputs"]);
  for (const child of readdirSync(current).sort()) {
    const childPath = join(current, child);
    if (isDir(childPath) && !skip.has(child)) {
      findRunsRecursive(root, childPath, runs);
    }
  }
}

function findRuns(workspace: string): Run[] {
  const runs: Run[] = [];
  findRunsRecursive(workspace, workspace, runs);
  runs.sort((a, b) => {
    const aId = typeof a.eval_id === "number" ? a.eval_id : Infinity;
    const bId = typeof b.eval_id === "number" ? b.eval_id : Infinity;
    if (aId !== bId) return aId - bId;
    return a.id.localeCompare(b.id);
  });
  return runs;
}

interface PreviousEntry {
  feedback: string;
  outputs: OutputFile[];
}

function loadPreviousIteration(workspace: string): Record<string, PreviousEntry> {
  const result: Record<string, PreviousEntry> = {};
  const feedbackMap: Record<string, string> = {};
  const feedbackPath = join(workspace, "feedback.json");
  if (existsSync(feedbackPath)) {
    try {
      const data = JSON.parse(readFileSync(feedbackPath, "utf-8"));
      for (const r of data.reviews ?? []) {
        if (r.feedback?.trim()) feedbackMap[r.run_id] = r.feedback;
      }
    } catch {
      // ignore
    }
  }

  const prevRuns = findRuns(workspace);
  for (const run of prevRuns) {
    result[run.id] = { feedback: feedbackMap[run.id] ?? "", outputs: run.outputs ?? [] };
  }
  for (const [runId, fb] of Object.entries(feedbackMap)) {
    if (!(runId in result)) result[runId] = { feedback: fb, outputs: [] };
  }
  return result;
}

function generateHtml(
  runs: Run[],
  skillName: string,
  previous?: Record<string, PreviousEntry>,
  benchmark?: unknown
): string {
  const templatePath = join(HERE, "viewer.html");
  const template = readFileSync(templatePath, "utf-8");

  const previousFeedback: Record<string, string> = {};
  const previousOutputs: Record<string, OutputFile[]> = {};
  if (previous) {
    for (const [runId, data] of Object.entries(previous)) {
      if (data.feedback) previousFeedback[runId] = data.feedback;
      if (data.outputs?.length) previousOutputs[runId] = data.outputs;
    }
  }

  const embedded: Record<string, unknown> = {
    skill_name: skillName,
    runs,
    previous_feedback: previousFeedback,
    previous_outputs: previousOutputs,
  };
  if (benchmark) embedded.benchmark = benchmark;

  const dataJson = JSON.stringify(embedded);
  return template.replace("/*__EMBEDDED_DATA__*/", `const EMBEDDED_DATA = ${dataJson};`);
}

async function killPort(port: number): Promise<void> {
  try {
    const { stdout } = await execFileAsync("lsof", ["-ti", `:${port}`], { timeout: 5000 });
    const pids = stdout.trim().split("\n").filter(Boolean);
    for (const pidStr of pids) {
      try {
        process.kill(Number(pidStr), "SIGTERM");
      } catch {
        // ignore
      }
    }
    if (pids.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  } catch (error: any) {
    if (error.code === "ENOENT") {
      console.error("Note: lsof not found, cannot check if port is in use");
    }
    // lsof exits non-zero when no process found; that's fine
  }
}

function parseCliArgs(argv: string[]) {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      port: { type: "string", short: "p", default: "3117" },
      "skill-name": { type: "string", short: "n" },
      "previous-workspace": { type: "string" },
      benchmark: { type: "string" },
      static: { type: "string", short: "s" },
    },
  });
  return { positionals, values };
}

async function main() {
  const { positionals, values } = parseCliArgs(process.argv.slice(2));
  const [workspaceArg] = positionals;
  if (!workspaceArg) {
    console.error("usage: generate_review.js <workspace-path> [--port PORT] [--skill-name NAME]");
    process.exit(2);
  }

  const workspace = resolve(workspaceArg);
  if (!isDir(workspace)) {
    console.error(`Error: ${workspace} is not a directory`);
    process.exit(1);
  }

  const runs = findRuns(workspace);
  if (!runs.length) {
    console.error(`No runs found in ${workspace}`);
    process.exit(1);
  }

  const skillName = (values["skill-name"] as string) || basename(workspace).replace("-workspace", "");
  const feedbackPath = join(workspace, "feedback.json");

  let previous: Record<string, PreviousEntry> = {};
  if (values["previous-workspace"]) {
    previous = loadPreviousIteration(resolve(values["previous-workspace"] as string));
  }

  const benchmarkPath = values.benchmark ? resolve(values.benchmark as string) : null;
  let benchmark: unknown = null;
  if (benchmarkPath && existsSync(benchmarkPath)) {
    try {
      benchmark = JSON.parse(readFileSync(benchmarkPath, "utf-8"));
    } catch {
      // ignore
    }
  }

  if (values.static) {
    const html = generateHtml(runs, skillName, previous, benchmark);
    const staticPath = resolve(values.static as string);
    mkdirSync(dirname(staticPath), { recursive: true });
    writeFileSync(staticPath, html);
    console.log(`\n  Static viewer written to: ${staticPath}\n`);
    process.exit(0);
  }

  let port = Number(values.port);
  await killPort(port);

  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (req.method === "GET" && (url === "/" || url === "/index.html")) {
      const liveRuns = findRuns(workspace);
      let liveBenchmark: unknown = null;
      if (benchmarkPath && existsSync(benchmarkPath)) {
        try {
          liveBenchmark = JSON.parse(readFileSync(benchmarkPath, "utf-8"));
        } catch {
          // ignore
        }
      }
      const html = generateHtml(liveRuns, skillName, previous, liveBenchmark);
      const content = Buffer.from(html, "utf-8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": content.length });
      res.end(content);
    } else if (req.method === "GET" && url === "/api/feedback") {
      const data = existsSync(feedbackPath) ? readFileSync(feedbackPath) : Buffer.from("{}");
      res.writeHead(200, { "Content-Type": "application/json", "Content-Length": data.length });
      res.end(data);
    } else if (req.method === "POST" && url === "/api/feedback") {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf-8");
        let resp: Buffer;
        let status: number;
        try {
          const data = JSON.parse(body);
          if (typeof data !== "object" || data === null || !("reviews" in data)) {
            throw new Error("Expected JSON object with 'reviews' key");
          }
          writeFileSync(feedbackPath, `${JSON.stringify(data, null, 2)}\n`);
          resp = Buffer.from('{"ok":true}');
          status = 200;
        } catch (error) {
          resp = Buffer.from(JSON.stringify({ error: (error as Error).message }));
          status = 500;
        }
        res.writeHead(status, { "Content-Type": "application/json", "Content-Length": resp.length });
        res.end(resp);
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", (error: any) => {
      if (error.code === "EADDRINUSE") {
        server.listen(0, "127.0.0.1", () => resolvePromise());
      } else {
        reject(error);
      }
    });
    server.listen(port, "127.0.0.1", () => resolvePromise());
  });
  const address = server.address();
  if (address && typeof address === "object") port = address.port;

  const url = `http://localhost:${port}`;
  console.log("\n  Eval Viewer");
  console.log("  ─────────────────────────────────");
  console.log(`  URL:       ${url}`);
  console.log(`  Workspace: ${workspace}`);
  console.log(`  Feedback:  ${feedbackPath}`);
  if (Object.keys(previous).length) {
    console.log(`  Previous:  ${values["previous-workspace"]} (${Object.keys(previous).length} runs)`);
  }
  if (benchmarkPath) console.log(`  Benchmark: ${benchmarkPath}`);
  console.log("\n  Press Ctrl+C to stop.\n");

  try {
    const platform = process.platform;
    const opener = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
    execFile(opener, [url]);
  } catch {
    // best-effort browser open; not fatal
  }

  process.on("SIGINT", () => {
    console.log("\nStopped.");
    server.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exit(1);
});
