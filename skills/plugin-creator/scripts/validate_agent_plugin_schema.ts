#!/usr/bin/env node
/** Offline, schema-driven Agent Plugins 1.0.0 manifest/MCP validator. */
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { ErrorObject, ValidateFunction } from "ajv";
import type Ajv2020Type from "ajv/dist/2020.js";
import type { JSONSchema7 } from "json-schema";
import { loadRuntimeDependency } from "./runtime-deps.js";

const AjvModule = loadRuntimeDependency<{ default?: typeof Ajv2020Type } & typeof Ajv2020Type>("ajv/dist/2020.js");
const Ajv2020 = AjvModule.default ?? AjvModule;
const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = dirname(HERE).endsWith("dist") ? dirname(dirname(HERE)) : dirname(HERE);
const SNAPSHOT = join(SKILL_ROOT, "references", "agent-plugins-1.0.0");
export const PLUGIN_SCHEMA_ID = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
export const MCP_SCHEMA_ID = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";

export type DocumentType = "manifest" | "mcp";
export interface Diagnostic { path: string; keyword: string; message: string; params: Record<string, unknown> }
export interface DocumentResult { file: string; type: DocumentType; valid: boolean; schema: { id: string; source: string }; errors: Diagnostic[] }
export interface SchemaValidationResult { valid: boolean; specification: "Agent Plugins 1.0.0"; documents: DocumentResult[]; errors: Diagnostic[] }

function isFile(path: string): boolean { try { return statSync(path).isFile(); } catch { return false; } }
function isDir(path: string): boolean { try { return statSync(path).isDirectory(); } catch { return false; } }
function schemaPath(type: DocumentType) { return join(SNAPSHOT, type === "manifest" ? "plugin.schema.json" : "mcp.schema.json"); }
function schemaId(type: DocumentType) { return type === "manifest" ? PLUGIN_SCHEMA_ID : MCP_SCHEMA_ID; }
function loadSchema(type: DocumentType): JSONSchema7 { return JSON.parse(readFileSync(schemaPath(type), "utf8")); }
function makeValidator(type: DocumentType): ValidateFunction {
  const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
  return ajv.compile(loadSchema(type));
}
function diagnostics(errors: ErrorObject[] | null | undefined): Diagnostic[] {
  return (errors ?? []).map(error => ({ path: error.instancePath || "/", keyword: error.keyword, message: error.message ?? "schema violation", params: error.params as Record<string, unknown> }));
}
function inferType(path: string, value: unknown, requested: "auto" | DocumentType): DocumentType {
  if (requested !== "auto") return requested;
  if (typeof value === "object" && value !== null && "$schema" in value) {
    const id = (value as Record<string, unknown>).$schema;
    if (id === MCP_SCHEMA_ID) return "mcp";
    if (id === PLUGIN_SCHEMA_ID) return "manifest";
  }
  const name = basename(path);
  if (name === "mcp.json" || name === ".mcp.json") return "mcp";
  return "manifest";
}
function validateFile(pathArg: string, requested: "auto" | DocumentType): DocumentResult {
  const file = resolve(pathArg); let value: unknown;
  try { value = JSON.parse(readFileSync(file, "utf8")); }
  catch (error) { return { file, type: requested === "mcp" ? "mcp" : "manifest", valid: false, schema: { id: requested === "mcp" ? MCP_SCHEMA_ID : PLUGIN_SCHEMA_ID, source: "vendored snapshot" }, errors: [{ path: "/", keyword: "parse", message: (error as Error).message, params: {} }] }; }
  const type = inferType(file, value, requested); const validator = makeValidator(type); const valid = Boolean(validator(value));
  return { file, type, valid, schema: { id: schemaId(type), source: schemaPath(type) }, errors: diagnostics(validator.errors) };
}
export function validateAgentPluginSchema(targetArg: string, requested: "auto" | DocumentType = "auto"): SchemaValidationResult {
  const target = resolve(targetArg); const files: Array<{path:string,type:"auto"|DocumentType}>=[];
  if (isDir(target)) {
    const manifest=join(target,"plugin.json"); if (isFile(manifest)) files.push({path:manifest,type:"manifest"});
    for (const name of ["mcp.json", ".mcp.json"]) { const path=join(target,name); if(isFile(path)) files.push({path,type:"mcp"}); }
    if (!files.length) return { valid:false, specification:"Agent Plugins 1.0.0", documents:[], errors:[{path:"/",keyword:"discovery",message:"No plugin.json, mcp.json, or .mcp.json found",params:{target}}] };
  } else if (isFile(target)) files.push({path:target,type:requested});
  else return { valid:false, specification:"Agent Plugins 1.0.0", documents:[], errors:[{path:"/",keyword:"filesystem",message:"Target does not exist",params:{target}}] };
  const documents=files.map(item=>validateFile(item.path,item.type));
  return { valid:documents.every(d=>d.valid), specification:"Agent Plugins 1.0.0", documents, errors:documents.flatMap(document=>document.errors.map(error=>({...error,path:document.file+error.path}))) };
}
function text(result:SchemaValidationResult):string { const lines:string[]=[]; for(const document of result.documents){lines.push(`${document.valid?"VALID":"INVALID"}: ${document.file} (${document.type})`);for(const error of document.errors)lines.push(`  ${error.path}: ${error.message} [${error.keyword}]`);}if(!result.documents.length)for(const error of result.errors)lines.push(`ERROR: ${error.message}`);return lines.join("\n"); }
function main(){const{positionals,values}=parseArgs({args:process.argv.slice(2),allowPositionals:true,options:{type:{type:"string",default:"auto"},format:{type:"string",default:"text"},quiet:{type:"boolean",short:"q",default:false}}});if(!positionals[0]||!["auto","manifest","mcp"].includes(values.type as string)||!["text","json"].includes(values.format as string)){console.error("usage: validate_agent_plugin_schema.js <file-or-directory> [--type auto|manifest|mcp] [--format text|json] [--quiet]");process.exit(2);}const result=validateAgentPluginSchema(positionals[0],values.type as any);if(!values.quiet)console.log(values.format==="json"?JSON.stringify(result,null,2):text(result));process.exit(result.valid?0:1);}
if(process.argv[1] && resolve(fileURLToPath(import.meta.url))===resolve(process.argv[1]))main();
