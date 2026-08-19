#!/usr/bin/env node
/**
 * Skill Packager - Creates a distributable .skill file of a skill folder
 *
 * Usage:
 *   node package_skill.js <path/to/skill-folder> [output-directory]
 */
import { existsSync, statSync, readdirSync, mkdirSync } from "node:fs";
import { resolve, join, basename, dirname } from "node:path";
import AdmZip from "adm-zip";
import { validateSkill } from "./quick_validate.js";

const EXCLUDE_DIRS = new Set([".git", ".hg", ".svn", "__pycache__", "node_modules"]);
const EXCLUDE_GLOBS = ["*.pyc"];
const EXCLUDE_FILES = new Set([".DS_Store"]);
const ROOT_EXCLUDE_DIRS = new Set(["evals"]);

function matchGlob(name: string, pattern: string): boolean {
  const regex = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
  return regex.test(name);
}

function shouldExclude(relParts: string[]): boolean {
  if (relParts.some((p) => EXCLUDE_DIRS.has(p))) return true;
  if (relParts.length > 1 && ROOT_EXCLUDE_DIRS.has(relParts[1])) return true;
  const name = relParts[relParts.length - 1];
  if (EXCLUDE_FILES.has(name)) return true;
  return EXCLUDE_GLOBS.some((pat) => matchGlob(name, pat));
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function collectFiles(current: string, out: string[]) {
  for (const entry of readdirSync(current).sort()) {
    const full = join(current, entry);
    if (isDir(full)) {
      collectFiles(full, out);
    } else {
      out.push(full);
    }
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
    collectFiles(skillPath, allFiles);

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

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
