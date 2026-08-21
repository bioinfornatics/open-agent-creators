import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
const EXCLUDED_PARTS = new Set([".git", ".hg", ".svn", ".beads", "__pycache__", "node_modules"]);
const ROOT_EXCLUDED_PARTS = new Set([".agents", ".claude", ".codex", "evaluations"]);
const ROOT_EXCLUDED_FILES = new Set(["CLAUDE.md"]);
const EXCLUDED_SUFFIXES = new Set([".pyc", ".pyo"]);
export interface PackageFile {
    absolute: string;
    relative: string;
    sha256: string;
}
export function shouldExcludePackagePath(path: string, rootArg: string): boolean {
    const root = resolve(rootArg);
    const rel = relative(root, resolve(path));
    if (!rel || rel === ".." || rel.startsWith(".." + sep))
        return false;
    const parts = rel.split(sep);
    if (ROOT_EXCLUDED_PARTS.has(parts[0]) || (parts.length === 1 && ROOT_EXCLUDED_FILES.has(parts[0])))
        return true;
    if (parts.some((part, index) => EXCLUDED_PARTS.has(part) && !(part === "node_modules" && parts[index - 1] === "vendor")))
        return true;
    return EXCLUDED_SUFFIXES.has(parts.at(-1)?.match(/\.[^.]+$/)?.[0] ?? "");
}
export function collectPackageFiles(rootArg: string, omitted: string[] = []): PackageFile[] {
    const root = resolve(rootArg);
    const omittedSet = new Set(omitted.map(path => resolve(path)));
    const files: PackageFile[] = [];
    function walk(directory: string): void {
        for (const name of readdirSync(directory).sort()) {
            const path = resolve(directory, name);
            if (shouldExcludePackagePath(path, root) || omittedSet.has(path))
                continue;
            const rel = relative(root, path);
            if (!rel || rel === ".." || rel.startsWith(".." + sep))
                throw new Error("package path escapes plugin root: " + path);
            const stat = lstatSync(path);
            if (stat.isSymbolicLink())
                throw new Error("symbolic links are not allowed in packages: " + rel);
            if (stat.isDirectory())
                walk(path);
            else if (stat.isFile())
                files.push({ absolute: path, relative: rel.split(sep).join("/"), sha256: createHash("sha256").update(readFileSync(path)).digest("hex") });
            else
                throw new Error("unsupported filesystem entry in package: " + rel);
        }
    }
    walk(root);
    return files.sort((a, b) => a.relative.localeCompare(b.relative));
}
export function sourceHash(root: string, omitted: string[] = []): string {
    const hash = createHash("sha256");
    for (const file of collectPackageFiles(root, omitted)) {
        hash.update(file.relative);
        hash.update("\0");
        hash.update(file.sha256);
        hash.update("\n");
    }
    return hash.digest("hex");
}