#!/usr/bin/env node
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { collectPackageFiles } from "./package_manifest.js";
import { loadRuntimeDependency } from "./runtime-deps.js";
import { validateAgentPluginSchema } from "./validate_agent_plugin_schema.js";
import { validate } from "./validate_goose_plugin.js";
const AdmZip = loadRuntimeDependency("adm-zip");
function isDirectory(path) {
    try {
        return statSync(path).isDirectory();
    }
    catch {
        return false;
    }
}
function validateOfflineSkills(root) {
    const skillsRoot = join(root, "skills");
    if (!isDirectory(skillsRoot))
        return [];
    const missing = [];
    for (const skill of readdirSync(skillsRoot).sort()) {
        const skillRoot = join(skillsRoot, skill);
        const packagePath = join(skillRoot, "package.json");
        if (!isDirectory(skillRoot) || !existsSync(packagePath))
            continue;
        const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
        if (!pkg.offlineBundle)
            continue;
        if (!isDirectory(join(skillRoot, "dist")))
            missing.push(`skills/${skill}/dist/`);
        if (!existsSync(join(skillRoot, "vendor", "manifest.json")))
            missing.push(`skills/${skill}/vendor/manifest.json`);
        if (!existsSync(join(skillRoot, "THIRD_PARTY_NOTICES.md")))
            missing.push(`skills/${skill}/THIRD_PARTY_NOTICES.md`);
        for (const dependency of Object.keys(pkg.dependencies ?? {})) {
            if (!isDirectory(join(skillRoot, "vendor", "node_modules", dependency)))
                missing.push(`skills/${skill}/vendor/node_modules/${dependency}`);
        }
    }
    return missing;
}
function fail(message) { console.error("ERROR: " + message); process.exit(1); }
function main() {
    const [pluginDirArg, outputArg] = process.argv.slice(2);
    if (!pluginDirArg) {
        console.error("usage: package_goose_plugin.js <plugin_dir> [output.zip]");
        process.exit(2);
    }
    const root = resolve(pluginDirArg);
    if (!isDirectory(root) || lstatSync(root).isSymbolicLink())
        fail("plugin root must be a real directory");
    const missing = validateOfflineSkills(root);
    if (missing.length)
        fail("Offline bundle is incomplete: " + missing.join(", "));
    const schema = validateAgentPluginSchema(root);
    if (!schema.valid) {
        for (const error of schema.errors)
            console.error(`SCHEMA ERROR: ${error.path}: ${error.message}`);
        process.exit(1);
    }
    const operational = validate(root);
    for (const warning of operational.warnings)
        console.error("WARNING: " + warning);
    if (operational.errors.length) {
        for (const error of operational.errors)
            console.error("ERROR: " + error);
        process.exit(1);
    }
    const output = outputArg ? resolve(outputArg) : join(dirname(root), basename(root) + ".zip");
    mkdirSync(dirname(output), { recursive: true });
    if (existsSync(output) && lstatSync(output).isSymbolicLink())
        fail("archive output cannot be a symbolic link");
    let files;
    try {
        files = collectPackageFiles(root, [output]);
    }
    catch (error) {
        fail(error.message);
    }
    const manifest = JSON.parse(readFileSync(join(root, "plugin.json"), "utf8"));
    const zip = new AdmZip();
    for (const file of files)
        zip.addFile(manifest.name + "/" + file.relative, readFileSync(file.absolute));
    zip.writeZip(output);
    console.log(output);
}
main();
