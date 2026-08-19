#!/usr/bin/env node
// Validate and package a Goose/Open Plugins directory.
import { execFileSync } from "node:child_process";
import { mkdirSync, statSync, readdirSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";

const HERE = dirname(fileURLToPath(import.meta.url));

const EXCLUDED_PARTS = new Set([".git", ".hg", ".svn", "__pycache__", "node_modules"]);
const EXCLUDED_SUFFIXES = new Set([".pyc", ".pyo"]);

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function shouldExclude(path: string, root: string): boolean {
  const relative = path.slice(root.length + 1);
  const parts = relative.split(/[\\/]/);
  if (parts.some((p) => EXCLUDED_PARTS.has(p))) return true;
  const suffix = path.includes(".") ? path.slice(path.lastIndexOf(".")) : "";
  return EXCLUDED_SUFFIXES.has(suffix);
}

function collectFiles(root: string, current: string, out: string[]) {
  for (const entry of readdirSync(current).sort()) {
    const full = join(current, entry);
    if (isDir(full)) {
      collectFiles(root, full, out);
    } else {
      out.push(full);
    }
  }
}

function main() {
  const [pluginDirArg, outputArg] = process.argv.slice(2);
  if (!pluginDirArg) {
    console.error("usage: package_goose_plugin.js <plugin_dir> [output.zip]");
    process.exit(2);
  }

  const root = resolve(pluginDirArg);
  const validator = join(HERE, "validate_goose_plugin.js");
  execFileSync("node", [validator, root], { stdio: "inherit" });

  const output = outputArg
    ? resolve(outputArg)
    : join(dirname(root), `${basename(root)}.zip`);
  mkdirSync(dirname(output), { recursive: true });

  const files: string[] = [];
  collectFiles(root, root, files);

  const zip = new AdmZip();
  const rootName = basename(root);
  for (const path of files) {
    if (shouldExclude(path, root) || resolve(path) === output) continue;
    const relative = path.slice(root.length + 1);
    const arcname = join(rootName, relative);
    zip.addLocalFile(path, dirname(arcname));
  }
  zip.writeZip(output);
  console.log(output);
}

main();
