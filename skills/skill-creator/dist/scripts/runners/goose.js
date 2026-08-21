// Goose runner for skill description and trigger evaluation.
import { spawn } from "node:child_process";
import { RunnerError } from "./base.js";
function shlexSplit(command) {
    const parts = [];
    const regex = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let match;
    while ((match = regex.exec(command)) !== null) {
        parts.push(match[1] ?? match[2] ?? match[3]);
    }
    return parts;
}
export class GooseRunner {
    command;
    constructor(command) {
        const raw = command || process.env.SKILL_CREATOR_GOOSE_COMMAND || "goose";
        this.command = shlexSplit(raw);
        if (!this.command.length) {
            throw new RunnerError("SKILL_CREATOR_GOOSE_COMMAND cannot be empty");
        }
    }
    textCommand(model) {
        const command = [...this.command, "run", "--no-session", "--quiet", "--output-format", "text", "--instructions", "-"];
        if (model)
            command.push("--model", model);
        return command;
    }
    streamCommand(query, model) {
        const command = [...this.command, "run", "--no-session", "--quiet", "--output-format", "stream-json", "--text", query];
        if (model)
            command.push("--model", model);
        return command;
    }
    async runText(prompt, model, timeout = 300, cwd) {
        const command = this.textCommand(model);
        const [bin, ...args] = command;
        return new Promise((resolvePromise, reject) => {
            const child = spawn(bin, args, { cwd, timeout: timeout * 1000 });
            let stdout = "";
            let stderr = "";
            child.stdout.on("data", (chunk) => (stdout += chunk));
            child.stderr.on("data", (chunk) => (stderr += chunk));
            child.on("error", (error) => {
                if (error.code === "ENOENT") {
                    reject(new RunnerError(`Goose command not found: ${this.command[0]}`));
                }
                else {
                    reject(error);
                }
            });
            child.on("close", (code) => {
                if (code !== 0) {
                    reject(new RunnerError(`Goose exited ${code}: ${command.join(" ")}\nstderr: ${stderr.trim()}`));
                    return;
                }
                resolvePromise(stdout);
            });
            child.stdin.write(prompt);
            child.stdin.end();
        });
    }
    startStream(query, model, cwd) {
        const command = this.streamCommand(query, model);
        const [bin, ...args] = command;
        try {
            return spawn(bin, args, { cwd, stdio: ["ignore", "pipe", "ignore"] });
        }
        catch (error) {
            throw new RunnerError(`Goose command not found: ${this.command[0]}`);
        }
    }
    eventLoadedSkill(event, skillName) {
        const eventType = event.type;
        if (eventType === "complete" || eventType === "error")
            return false;
        if (eventType !== "message")
            return null;
        const message = event.message ?? {};
        const content = message.content ?? [];
        for (const item of content) {
            if (!["toolRequest", "tool_request"].includes(item.type))
                continue;
            let toolCall = (item.toolCall ?? item.tool_call ?? {});
            if (typeof toolCall === "object" && toolCall !== null && "Ok" in toolCall) {
                toolCall = toolCall.Ok;
            }
            if (typeof toolCall === "object" && toolCall !== null && "value" in toolCall) {
                toolCall = toolCall.value;
            }
            if (typeof toolCall !== "object" || toolCall === null)
                continue;
            const name = String(toolCall.name ?? "");
            let args = toolCall.arguments ?? {};
            if (name.split("__").pop() !== "load_skill")
                continue;
            if (typeof args === "string") {
                try {
                    args = JSON.parse(args);
                }
                catch {
                    args = {};
                }
            }
            const loaded = typeof args === "object" && args !== null ? String(args.name ?? "") : "";
            return loaded === skillName || loaded.startsWith(`${skillName}/`);
        }
        return null;
    }
}
