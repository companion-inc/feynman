import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
export default async function registerOfflineProvider(pi) {
 const modules=path.join(process.env.PROOF_ROOT,'.feynman/npm/node_modules');
 const {createAssistantMessageEventStream}=await import(pathToFileURL(path.join(modules,'@earendil-works/pi-ai/dist/index.js')));
 const {Type}=await import(pathToFileURL(path.join(modules,'typebox/build/index.mjs')));
 const record=(type,data={})=>fs.appendFileSync(path.join(process.env.HOME,'provider-proof.jsonl'),JSON.stringify({type,pid:process.pid,...data})+'\n');
 let calls=0;
 pi.registerTool({name:'proof_side_effect',label:'Offline counter',description:'An offline test counter',parameters:Type.Object({}),async execute(){record('side-effect');return {content:[{type:'text',text:'counted'}],details:{}};}});
 pi.registerProvider('offline-proof',{api:'offline-proof-api',apiKey:'fixture-not-a-real-key',baseUrl:'https://offline.invalid',models:[{id:'safe',name:'Offline Safe',reasoning:false,input:['text'],contextWindow:128000,maxTokens:2048,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}],streamSimple(model){
  calls++;record('provider-call',{calls});const stream=createAssistantMessageEventStream();
  queueMicrotask(()=>{const wrong=process.env.PROOF_MODE==='wrong';const message={role:'assistant',api:model.api,provider:wrong?'wrong-provider':model.provider,model:wrong?'wrong-model':model.id,content:calls===1?[{type:'toolCall',id:'offline-call',name:'proof_side_effect',arguments:{}}]:[{type:'text',text:'OFFLINE_DETACHED_DONE'}],stopReason:calls===1?'toolUse':'stop',timestamp:Date.now(),usage:{input:1,output:1,totalTokens:2,cacheRead:0,cacheWrite:0,cost:{input:0,output:0,total:0,cacheRead:0,cacheWrite:0}}};stream.push({type:'start',partial:message});stream.push({type:'done',reason:message.stopReason,message});stream.end(message);});return stream;
 }});
 pi.on('session_start',()=>record('registered',{tools:pi.getAllTools().map(t=>t.name),active:pi.getActiveTools()}));
 pi.on('session_shutdown',()=>record('shutdown'));
}
