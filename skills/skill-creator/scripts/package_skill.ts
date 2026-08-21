#!/usr/bin/env node
/**
 * Skill Packager - Creates a distributable .skill file of a skill folder
 *
 * Usage:
 *   node package_skill.js <path/to/skill-folder> [output-directory]
 */
import { existsSync, lstatSync, readdirSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type AdmZipType from "adm-zip";
import { validateSkill } from "./quick_validate.js";
import { loadRuntimeDependency } from "./runtime-deps.js";

const AdmZip = loadRuntimeDependency<typeof AdmZipType>("adm-zip");

const EXCLUDE_DIRS = new Set([".git", ".hg", ".svn", "__pycache__", "node_modules"]);
const EXCLUDE_GLOBS = ["*.pyc"];
const EXCLUDE_FILES = new Set([".DS_Store"]);
const ROOT_EXCLUDE_DIRS = new Set(["evals"]);

function matchGlob(name: string, pattern: string): boolean {
  const regex = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
  return regex.test(name);
}

function shouldExclude(relParts: string[]): boolean {
  if (relParts.some((part, index) => EXCLUDE_DIRS.has(part) && !(part === "node_modules" && relParts[index - 1] === "vendor"))) return true;
  if (relParts.length > 1 && ROOT_EXCLUDE_DIRS.has(relParts[1])) return true;
  const name = relParts[relParts.length - 1];
  if (EXCLUDE_FILES.has(name)) return true;
  return EXCLUDE_GLOBS.some((pat) => matchGlob(name, pat));
}

function isDir(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function validateOfflineBundle(skillPath: string): string[] {
  const packagePath = join(skillPath, "package.json");
  if (!existsSync(packagePath)) return [];
  const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
  if (!pkg.offlineBundle) return [];
  const missing: string[] = [];
  if (!isDir(join(skillPath, "dist"))) missing.push("dist/");
  if (!existsSync(join(skillPath, "vendor", "manifest.json"))) missing.push("vendor/manifest.json");
  if (!existsSync(join(skillPath, "THIRD_PARTY_NOTICES.md"))) missing.push("THIRD_PARTY_NOTICES.md");
  for (const dependency of Object.keys(pkg.dependencies ?? {})) {
    if (!isDir(join(skillPath, "vendor", "node_modules", dependency))) {
      missing.push(`vendor/node_modules/${dependency}`);
    }
  }
  return missing;
}

function collectFiles(current: string, out: string[], parentDir: string) {
  for (const entry of readdirSync(current).sort()) {
    const full = join(current, entry);
    const relPath = full.slice(parentDir.length + 1);
    if (shouldExclude(relPath.split(/[\\/]/))) continue;
    if (isSymlink(full)) throw new Error(`Refusing to package symbolic link: ${relPath}`);
    if (isDir(full)) collectFiles(full, out, parentDir);
    else out.push(full);
  }
}

export function packageSkill(skillPathArg: string, outputDirArg?: string): string | null {
  const skillPath = resolve(skillPathArg);

  if (!existsSync(skillPath)) {
    console.log(`❌ Error: Skill folder not found: ${skillPath}`);
    return null;
  }
  if (!isDir(skillPath)) {
    console.log(`❌ Error: Path is not a directory: ${skillPath}`);
    return null;
  }

  const skillMd = join(skillPath, "SKILL.md");
  if (!existsSync(skillMd)) {
    console.log(`❌ Error: SKILL.md not found in ${skillPath}`);
    return null;
  }

  console.log("🔍 Validating skill...");
  const [valid, message] = validateSkill(skillPath);
  if (!valid) {
    console.log(`❌ Validation failed: ${message}`);
    console.log("   Please fix the validation errors before packaging.");
    return null;
  }
  console.log(`✅ ${message}\n`);

  const missingOffline = validateOfflineBundle(skillPath);
  if (missingOffline.length) {
    console.log(`❌ Offline bundle is incomplete: ${missingOffline.join(", ")}`);
    console.log("   Run the repository's scripts/prepare-offline-bundle.mjs before packaging.");
    return null;
  }

  const skillName = basename(skillPath);
  let outputPath: string;
  if (outputDirArg) {
    outputPath = resolve(outputDirArg);
    mkdirSync(outputPath, { recursive: true });
  } else {
    outputPath = process.cwd();
  }
  const skillFilename = join(outputPath, `${skillName}.skill`);

  try {
    const zip = new AdmZip();
    const parentDir = dirname(skillPath);
    const allFiles: string[] = [];
    collectFiles(skillPath, allFiles, parentDir);

    for (const filePath of allFiles) {
      const relPath = filePath.slice(parentDir.length + 1);
      const relParts = relPath.split(/[\\/]/);
      if (shouldExclude(relParts)) {
        console.log(`  Skipped: ${relPath}`);
        continue;
      }
      zip.addLocalFile(filePath, dirname(relPath) === "." ? "" : dirname(relPath));
      console.log(`  Added: ${relPath}`);
    }

    zip.writeZip(skillFilename);
    console.log(`\n✅ Successfully packaged skill to: ${skillFilename}`);
    return skillFilename;
  } catch (error) {
    console.log(`❌ Error creating .skill file: ${(error as Error).message}`);
    return null;
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log("Usage: node package_skill.js <path/to/skill-folder> [output-directory]");
    console.log("\nExample:");
    console.log("  node package_skill.js skills/public/my-skill");
    console.log("  node package_skill.js skills/public/my-skill ./dist");
    process.exit(1);
  }

  const [skillPath, outputDir] = args;
  console.log(`📦 Packaging skill: ${skillPath}`);
  if (outputDir) console.log(`   Output directory: ${outputDir}`);
  console.log();

  const result = packageSkill(skillPath, outputDir);
  process.exit(result ? 0 : 1);
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  main();
}
