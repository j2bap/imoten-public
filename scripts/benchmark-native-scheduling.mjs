#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const summarize = process.argv.includes('--summarize');
const outputArgument = process.argv.indexOf('--output');
if (outputArgument >= 0 && !process.argv[outputArgument+1]) throw new Error('--output needs a directory');
const output = check ? await fs.mkdtemp(path.join(os.tmpdir(),'scheduling-check-')) : path.resolve(outputArgument >= 0 ? process.argv[outputArgument+1] : path.join(repo, '.audit/scheduling-real-tasks-2026-10-02'));
if (!check && !summarize) {
  try {
    await fs.access(path.join(output,'manifest.json'));
    throw new Error('Output already contains an experiment. Use --output with a new directory.');
  }
  catch (error) { if(error.code !== 'ENOENT') throw error; }
}
const frozen = path.join(output, 'source');
const model = 'gpt-6-astra';
const effort = 'low';
const files = ['skills/setup-pstack/scripts/imoten-profile.mjs', 'skills/setup-pstack/scripts/context-manager.mjs', 'skills/poteto-mode/scripts/classifier-decision-adapter.mjs', 'skills/poteto-mode/scripts/read-stdin.mjs'];
const hash = text => createHash('sha256').update(text).digest('hex');
const median = xs => { const sorted = [...xs].sort((a,b) => a-b); return (sorted[Math.floor((sorted.length-1)/2)] + sorted[Math.ceil((sorted.length-1)/2)])/2; };
await fs.mkdir(output, { recursive: true });
const setupStart = performance.now();
const manifest = {};
for (const file of files) {
  const bytes = await fs.readFile(path.join(summarize ? frozen : repo,file));
  manifest[file] = hash(bytes);
  if (!summarize) {
    await fs.mkdir(path.dirname(path.join(frozen,file)), {recursive:true});
    await fs.writeFile(path.join(frozen,file),bytes);
  }
}
const packet = {id:'audit',objective:'Check safe scheduling',inputBundles:[],allowedPaths:['src/a'],writeMode:'read_only',expectedResult:'answer',deadlineMs:1000};
const classifier = {provider:'classifier.dev',label:'spawn',confidence:0.95};
const tasks = [
  {id:'identity',file:files[0],symbol:'parseCodexIdentity',cases:[
    ['model = "gpt-6-astra"\nmodel_reasoning_effort = "low"'],
    ['model_provider = \'native\'\n[profiles.other]\nmodel="ignored"'],
    ['model = first\nmodel = second\nunknown = value'],
    ['default_permissions = "read-only"\napprovals_reviewer = "auto_review"'],
    ['model = unquoted # comment\nmodel_catalog_json = \'/tmp/catalog.json\''],
  ]},
  {id:'classifier',file:files[2],symbol:'adaptClassifierResult',cases:[
    [{state:{id:1},question:{type:'choice',criteria:['spawn','no_match']},result:{results:[{label:'spawn',confidence:0.8,scores:{spawn:0.8,no_match:0.2}}]}}],
    [{state:null,question:{type:'noul'},result:{model:'small',results:[{label:'yes',confidence:0.9,scores:{yes:0.75,no:0.25}}]}}],
    [{state:'s',question:{type:'score',criteria:['low','medium','high','no_match']},result:{results:[{label:'medium',confidence:0.6,scores:{low:0.2,medium:0.6,high:0.2}}]}}],
    [{state:0,question:{type:'noul'},result:{results:[{label:'yes',confidence:0.9,scores:{yes:0.9,no:0.9}}]}}],
    [{state:0,question:{type:'noul'},result:{results:[{label:'maybe',confidence:0.9,scores:{yes:0.5,no:0.5}}]}}],
  ]},
  {id:'gate',file:files[1],symbol:'evaluateSubagentGate',cases:[
    [{packet,classifier}], [{packet,classifier:{...classifier,confidence:0.79}}],
    [{packet,classifier,compaction:'sealed',openDependencyCount:1}],
    [{packet:{...packet,writeMode:'isolated_write'},sharedMutablePaths:['src/a'],classifier}],
    [{packet:{...packet,extra:true},classifier}], [{packet,classifier:{...classifier,provider:'unknown'}}],
  ]},
  {id:'request',file:files[2],symbol:'buildClassifierRequest',cases:[
    [{type:'choice',criteria:{spawn:'Independent',no_match:'Unclear'},instructions:'Choose safely.'},{input:'Read two modules'}],
    [{type:'score',criteria:['low','high','no_match']},{input:'Assess risk',tier:'smart'}],
    [{type:'noul'},{input:'Ready?'}],
    [{type:'choice',criteria:['a','a']},{input:'duplicate'}],
    [{type:'noul'},{input:'x',tier:'invalid'}],
  ]},
];
for (const task of tasks) {
  const module = await import(pathToFileURL(path.join(frozen,task.file)));
  task.expected = task.cases.map(args => { try { return {value:module[task.symbol](...args)}; } catch(error) { return {error:error.message}; } });
}
const publicTask = ({expected,...task}) => task;
const prefix = path.join(output,'prefix.json');
if (!summarize) await fs.writeFile(prefix,JSON.stringify([{name:'scope',text:'This scope is self-contained. Read only named frozen source files and their direct imports. Do not read instructions, skills, history, secrets, or unrelated files. Other actors may edit the repository. Do not write files, spawn agents, or use the network. Use local read-only tools to inspect and execute the supplied repository functions. Return only JSON. For each task return its id mapped to an array of {value: returnValue} or {error: exactErrorMessage} in case order. These are repository behavior audits. Preserve every field and value.'}]));
const portable = path.join(repo,'skills/poteto-mode/references/poteto-agent-prompt.md');
const setupMs = performance.now()-setupStart;
const metadata = {model,effort,source_commit:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),source_sha256:manifest,setup_ms:setupMs,tasks:tasks.map(publicTask),trials:5,timeout_ms:180000};
if (!summarize) await fs.writeFile(path.join(output,'manifest.json'),JSON.stringify(metadata,null,2));
function finalJson(answer) {
  const lines=answer.trim().replace(/\s*```$/,'').split('\n');
  for(let index=lines.length-1;index>=0;index--) {
    if(!lines[index].trimStart().startsWith('{')) continue;
    try {return JSON.parse(lines.slice(index).join('\n'));}catch(error) {if(!(error instanceof SyntaxError)) throw error;}
  }
  throw new Error('Final JSON object is missing');
}
function score(answer, assigned) {
  try {
    const parsed = finalJson(answer);
    return isDeepStrictEqual(parsed,Object.fromEntries(assigned.map(t=>[t.id,t.expected])));
  } catch { return false; }
}
if (!tasks.every(t=>score(JSON.stringify({[t.id]:t.expected}),[t])&&score('{"status":"checking"}\n'+JSON.stringify({[t.id]:t.expected}),[t])) || score('{}',tasks)) throw new Error('oracle sensitivity check failed');
if (check) {
  console.log(JSON.stringify({status:'passed',cases:tasks.reduce((n,t)=>n+t.cases.length,0),source_sha256:manifest}));
  await fs.rm(output,{recursive:true});
  process.exit(0);
}
if (summarize) {
  const raw = JSON.parse(await fs.readFile(path.join(output,'results.json'),'utf8'));
  if (!isDeepStrictEqual(manifest,raw.metadata.source_sha256)||!isDeepStrictEqual(tasks.map(publicTask),raw.metadata.tasks)) throw new Error('Frozen source or task definitions changed');
  const rows = raw.rows.filter(row=>row.parent&&row.parallel).map(row=>{
    const assigned=tasks.slice(row.fixture*2,row.fixture*2+2);
    const arms={};
    for(const arm of ['parent','parallel']) {
      const start=performance.now();
      let merged={};
      let parsed=true;
      for(const run of row[arm].runs) {try {Object.assign(merged,finalJson(run.result?.assistant_text??''));}catch {parsed=false;}}
      const correct=parsed&&row[arm].runs.every(r=>r.exit.code===0&&r.result?.status==='completed')&&score(JSON.stringify(merged),assigned);
      const assembly_ms=performance.now()-start;
      const usage={};
      for(const key of ['input_tokens','cached_input_tokens','output_tokens','total_tokens']) {
        const values=row[arm].runs.map(run=>run.result?.usage?.[key]);
        usage[key]=values.every(Number.isSafeInteger)?values.reduce((sum,value)=>sum+value,0):null;
      }
      arms[arm]={wall_ms:row[arm].wall_ms,assembly_ms,correct,strict_aggregate_text_json:row[arm].correct,usage};
    }
    return {fixture:row.fixture,trial:row.trial,order:row.order,...arms};
  });
  const parent=median(rows.map(r=>r.parent.wall_ms));
  const parallel=median(rows.map(r=>r.parallel.wall_ms));
  const summary={pairs:rows.length,parent_median_ms:parent,parallel_median_ms:parallel,median_reduction_percent:100*(parent-parallel)/parent,faster_pairs:rows.filter(r=>r.parallel.wall_ms<r.parent.wall_ms).length,correct_arms:rows.flatMap(r=>[r.parent.correct,r.parallel.correct]).filter(Boolean).length,total_arms:rows.length*2,usage:{}};
  const reductions=rows.map(r=>100*(r.parent.wall_ms-r.parallel.wall_ms)/r.parent.wall_ms);
  summary.paired_reduction_range_percent=[Math.min(...reductions),Math.max(...reductions)];
  summary.fixtures=[0,1].map(fixture=>{
    const selected=rows.filter(row=>row.fixture===fixture);
    return {fixture,pairs:selected.length,parent_median_ms:median(selected.map(r=>r.parent.wall_ms)),parallel_median_ms:median(selected.map(r=>r.parallel.wall_ms))};
  });
  for(const arm of ['parent','parallel']) {
    summary.usage[arm]=Object.fromEntries(['input_tokens','cached_input_tokens','output_tokens','total_tokens'].map(key=>[key,rows.every(row=>Number.isSafeInteger(row[arm].usage[key]))?rows.reduce((sum,row)=>sum+row[arm].usage[key],0):null]));
    summary.usage[arm].uncached_input_tokens=Number.isSafeInteger(summary.usage[arm].input_tokens)&&Number.isSafeInteger(summary.usage[arm].cached_input_tokens)?summary.usage[arm].input_tokens-summary.usage[arm].cached_input_tokens:null;
  }
  const report={metadata:raw.metadata,raw_results:path.join(output,'results.json'),model_identity:'Requested native gpt-6-astra with low effort. Inspect each ready receipt for app-server thread settings; the requested model alone does not prove served-model identity.',usage_limit:'Counters depend on the recorded adapter revision. Older revisions retained only tokenUsage.last; current revisions calculate per-turn cumulative deltas. Missing counters remain null. Historical counts cannot be repaired from last-call data. These are not billing costs.',scorer_amendment:'The native adapter joins commentary and final output. Parse the final JSON object at a line boundary identically in every arm. Preserve original strict aggregate-text result. Assembly and re-scoring happen after the experiment and their time is reported separately.',rows,summary};
  const reportPath=outputArgument >= 0 ? path.join(output,'summary.json') : path.join(repo,'docs/reports/2026-10-02-scheduling-real-tasks.json');
  await fs.writeFile(reportPath,JSON.stringify(report,null,2));
  console.log(JSON.stringify({report:reportPath,...summary}));
  process.exit(0);
}
async function run(name,assigned) {
  const start = performance.now();
  const task = JSON.stringify(assigned.map(publicTask));
  const args = [path.join(repo,'skills/setup-pstack/scripts/imoten-workflow-dispatch.mjs'),'--profile','personal','--root-dir',path.join(output,name),'--model',model,'--reasoning-effort',effort,'--cwd',frozen,'--common-prefix-file',prefix,'--poteto-prompt-file',portable,'--turn-timeout-ms','180000'];
  const child = spawn(process.execPath,args,{cwd:repo,env:{...process.env,CODEX_HOME:path.join(os.homedir(),'.codex-personal')},stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='',pending='',sent=false;
  child.stderr.on('data',data=>{stderr+=data;});
  child.stdout.on('data',data=>{
    stdout+=data; pending+=data;
    let end;
    while ((end=pending.indexOf('\n'))>=0) {
      const line=pending.slice(0,end); pending=pending.slice(end+1);
      let message; try {message=JSON.parse(line);} catch {continue;}
      if(message.type==='ready'&&!sent) {sent=true;child.stdin.write(JSON.stringify({op:'run',id:name,task})+'\n');}
      if(message.type==='result'||message.type==='error') child.stdin.end(JSON.stringify({op:'close'})+'\n');
    }
  });
  const exit = await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',(code,signal)=>resolve({code,signal}));});
  await fs.writeFile(path.join(output,name+'.jsonl'),stdout);
  await fs.writeFile(path.join(output,name+'.stderr.log'),stderr);
  const messages=stdout.split('\n').filter(Boolean).map(line=>{try{return JSON.parse(line);}catch{return {};}});
  const result=messages.find(m=>m.type==='result');
  return {name,wall_ms:performance.now()-start,exit,correct:exit.code===0&&result?.status==='completed'&&score(result.assistant_text,assigned),result:result??null,errors:messages.filter(m=>m.type==='error')};
}
const rows=[];
for(let fixture=0;fixture<2;fixture++) {
  const assigned=tasks.slice(fixture*2,fixture*2+2);
  for(let trial=0;trial<5;trial++) {
    const row={fixture,trial,order:trial%2?['parallel','parent']:['parent','parallel']};
    for(const arm of row.order) {
      const start=performance.now();
      const runs=arm==='parent'?[await run(`f${fixture}-t${trial}-${arm}`,assigned)]:await Promise.all(assigned.map((task,index)=>run(`f${fixture}-t${trial}-${arm}-${index}`,[task])));
      row[arm]={wall_ms:performance.now()-start,runs,correct:runs.every(r=>r.correct),rework:0};
      console.log(JSON.stringify({fixture,trial,arm,wall_ms:row[arm].wall_ms,correct:row[arm].correct}));
      if(runs.some(r=>r.exit.code!==0||!r.result)) {
        await fs.writeFile(path.join(output,'results.json'),JSON.stringify({metadata,rows:[...rows,row],blocked:true},null,2));
        throw new Error('Transport failed; see saved results. No model retry.');
      }
    }
    rows.push(row);
    await fs.writeFile(path.join(output,'results.json'),JSON.stringify({metadata,rows},null,2));
  }
}
const parent=median(rows.map(r=>r.parent.wall_ms));
const parallel=median(rows.map(r=>r.parallel.wall_ms));
const summary={parent_median_ms:parent,parallel_median_ms:parallel,median_reduction_percent:100*(parent-parallel)/parent,correct:rows.every(r=>r.parent.correct&&r.parallel.correct),pairs:rows.length};
await fs.writeFile(path.join(output,'results.json'),JSON.stringify({metadata,rows,summary},null,2));
console.log(JSON.stringify(summary));
