import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
const root=process.env.PROOF_ROOT;
if (!root || !process.env.HOME) throw new Error('Offline child proof requires isolated root and HOME');
const sub=path.join(root,'.feynman/npm/node_modules/pi-subagents');
let network=0;
globalThis.fetch=async()=>{network++;throw new Error('OFFLINE PROOF BLOCKED FETCH');};
const blocked=()=>{network++;throw new Error('OFFLINE PROOF BLOCKED SOCKET');};
net.Socket.prototype.connect=blocked; http.request=blocked; https.request=blocked;
const {createDefaultChildSessionFactory}=await import(pathToFileURL(path.join(sub,'src/runs/shared/child-session.ts')));
const {buildInProcessChildLaunch}=await import(pathToFileURL(path.join(sub,'src/runs/shared/child-launch.ts')));
const {runChildSession}=await import(pathToFileURL(path.join(sub,'src/runs/background/run-child-session.ts')));
const piAi=await import(pathToFileURL(path.join(root,'.feynman/npm/node_modules/@earendil-works/pi-ai/dist/index.js')));
const {Type}=await import(pathToFileURL(path.join(root,'.feynman/npm/node_modules/typebox/build/index.mjs')));
const cwd=process.env.HOME;
const {normalizeFeynmanSettings}=await import(pathToFileURL(path.join(root,'src/pi/settings.ts')));
const normalizedPath=path.join(cwd,'proof-settings.json');
const emptySettings=path.join(cwd,'empty-settings.json'); fs.writeFileSync(emptySettings,'{}');
await normalizeFeynmanSettings(normalizedPath,emptySettings,'medium',path.join(cwd,'empty-auth.json'),{researchToolsExtensionPath:path.join(root,'extensions/research-tools.ts')});
const researcher=JSON.parse(fs.readFileSync(normalizedPath)).subagents.agentOverrides.researcher;
const proof={codingAgentEntry:path.join(root,'.feynman/npm/node_modules/@earendil-works/pi-coding-agent/dist/index.js'),subagents:JSON.parse(fs.readFileSync(path.join(sub,'package.json'))).version};
const model={id:'safe',name:'Offline safe',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:128000,maxTokens:2000};
let calls=0,sideEffects=0,registered=[],active=[],errors=[];
const mode=process.env.PROOF_MODE;
const providerHook={name:'offline-proof',factory(pi){
 pi.registerTool({name:'proof_side_effect',label:'proof side effect',description:'Offline counter only',parameters:Type.Object({}),async execute(){sideEffects++;return {content:[{type:'text',text:'counted'}],details:{}};}});
 pi.registerProvider('offline-proof',{api:'offline-proof-api',apiKey:'fixture-not-a-real-key',baseUrl:'https://offline.invalid',models:[model],streamSimple(model,context,options){
  calls++; const stream=piAi.createAssistantMessageEventStream();
  queueMicrotask(()=>{const wrong=mode==='wrong'||mode==='wrong-end';const content=calls===1?[{type:'toolCall',id:'proof-call',name:'proof_side_effect',arguments:{}}]:[{type:'text',text:'OFFLINE_DONE'}];
   const message={role:'assistant',api:model.api,provider:wrong?'wrong-provider':model.provider,model:wrong?'wrong-model':model.id,content,stopReason:calls===1?'toolUse':'stop',timestamp:Date.now(),usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
   stream.push({type:'start',partial:mode==='wrong-end'?{...message,provider:model.provider,model:model.id}:message});stream.push({type:'done',reason:message.stopReason,message});stream.end(message);});return stream;
 }});
 pi.on('session_start',()=>{registered=pi.getAllTools().map(t=>t.name);active=pi.getActiveTools();});
}};
let factory;
try{
 const launch=buildInProcessChildLaunch({sessionEnabled:false,model:'offline-proof/safe',inheritProjectContext:false,inheritGlobalContext:false,inheritSkills:false,cwd,childAgentName:'researcher',childIndex:0,host:process.env.PROOF_HOST==='parent'?'parent':'runner',extensions:[],subagentOnlyExtensions:researcher.subagentOnlyExtensions,tools:['proof_side_effect','hf_dataset_info','hf_repo_files','hf_repo_read_file'],systemPrompt:'Offline child proof',systemPromptMode:'replace'});
 launch.session.hooks.push(providerHook);
 launch.session.onExtensionError=e=>errors.push(String(e.error));
 factory=createDefaultChildSessionFactory();
 const events=[];
 const result=await runChildSession({factory,launch,prompt:'Run the proof tool once.',expectedModelForVerification:'offline-proof/safe',modelVerificationRegistry:[{provider:'offline-proof',id:'safe',fullId:'offline-proof/safe'}],appendChildEvent:e=>events.push(e.type),writeOutputLine:()=>{},childEventContext:{runId:'offline-proof',stepIndex:0,agent:'researcher'},runDeadlineAt:Date.now()+20000});
 Object.assign(proof,{mode,result:{exitCode:result.exitCode,error:result.error},calls,sideEffects,registered,active,extensionPaths:launch.session.extensionPaths,settingsExtensions:researcher.subagentOnlyExtensions,events,errors,network});
}catch(e){Object.assign(proof,{fatal:e.stack,calls,sideEffects,registered,active,errors,network});process.exitCode=1;}
finally{await factory?.dispose();}
console.log('PROOF_JSON='+JSON.stringify(proof));
