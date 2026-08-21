// Resolve pure-JavaScript runtime dependencies from either a normal install
// or the vendored offline bundle shipped with this skill.
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const parent = dirname(here);
const skillRoot = parent.endsWith(`${process.platform === "win32" ? "\\" : "/"}dist`)
    ? dirname(parent)
    : parent;
const requireFromHere = createRequire(import.meta.url);
export function loadRuntimeDependency(name) {
    try {
        return requireFromHere(name);
    }
    catch (normalError) {
        const vendored = resolve(join(skillRoot, "vendor", "node_modules", name));
        try {
            return requireFromHere(vendored);
        }
        catch (vendoredError) {
            const error = new Error(`Could not load runtime dependency '${name}'. Expected the offline bundle at ${vendored}. ` +
                "This is a packaging defect; do not run npm install in the consumer project.");
            error.cause = vendoredError ?? normalError;
            throw error;
        }
    }
}
