import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT=join(fileURLToPath(new URL(".",import.meta.url)),".."); const CLI=join(ROOT,"dist","scripts","cli.js");
function plugin(tmp:string){const root=join(tmp,"demo-plugin");mkdirSync(join(root,"skills","demo"),{recursive:true});writeFileSync(join(root,"plugin.json"),JSON.stringify({$schema:"https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",name:"demo-plugin",version:"1.0.0",description:"Demo"}));writeFileSync(join(root,"skills","demo","SKILL.md"),"---\nname: demo\ndescription: Demo tasks\n---\n\n# Demo\n");return root;}
test("CLI JSON validation and usage code",()=>{const tmp=mkdtempSync(join(tmpdir(),"plugin-cli-"));try{const root=plugin(tmp);const result=JSON.parse(execFileSync(process.execPath,[CLI,"validate",root,"--format","json"],{encoding:"utf8"}));assert.equal(result.ok,true);assert.equal(spawnSync(process.execPath,[CLI,"unknown"]).status,2);}finally{rmSync(tmp,{recursive:true,force:true});}});
test("CLI maps blocked verification to exit 3",()=>{const tmp=mkdtempSync(join(tmpdir(),"plugin-cli-"));try{const result=spawnSync(process.execPath,[CLI,"verify",plugin(tmp),"--profile","static","--quiet"],{encoding:"utf8"});assert.equal(result.status,3);assert.equal(result.stdout,"");}finally{rmSync(tmp,{recursive:true,force:true});}});
test("package rejects schema-invalid plugin before archive",()=>{const tmp=mkdtempSync(join(tmpdir(),"plugin-cli-"));try{const root=plugin(tmp),output=join(tmp,"plugin.zip");writeFileSync(join(root,"plugin.json"),JSON.stringify({name:"demo-plugin",version:"1.0.0",description:"invalid"}));const result=spawnSync(process.execPath,[CLI,"package",root,output],{encoding:"utf8"});assert.equal(result.status,1);assert.equal(existsSync(output),false);assert.match(result.stderr,/SCHEMA ERROR/);}finally{rmSync(tmp,{recursive:true,force:true});}});
