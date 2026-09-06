import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {EventEmitter} from 'node:events';
const root=process.env.PROOF_ROOT, home=process.env.HOME;
const sub=path.join(root,'.feynman/npm/node_modules/pi-subagents');
const {executeAsyncSingle}=await import(pathToFileURL(path.join(sub,'src/runs/background/async-execution.ts')));
const {DIRS,SUBAGENT_ASYNC_STARTED_EVENT}=await import(pathToFileURL(path.join(sub,'src/shared/types.ts')));
const events=new EventEmitter();let pid,asyncDir,exited=false;
events.on(SUBAGENT_ASYNC_STARTED_EVENT,e=>{pid=e.pid;});
const pi={events,getAllTools:()=>[],getActiveTools:()=>[]};
const agent={name:'researcher',description:'Offline research child proof',source:'runtime',systemPrompt:'Run the offline counter once, then finish.',systemPromptMode:'replace',inheritProjectContext:false,inheritGlobalContext:false,inheritSkills:false,model:'offline-proof/safe',thinking:false,tools:['proof_side_effect','hf_dataset_info','hf_repo_files','hf_repo_read_file'],extensions:[],subagentOnlyExtensions:[path.join(root,'extensions/research-tools.ts'),path.join(root,'tests/helpers/pi-subagents-detached-provider.mjs')],completionGuard:false};
const id='offline-detached-'+process.env.PROOF_MODE;
const readJSON=p=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch{return undefined;}};
try{
 const start=executeAsyncSingle(id,{agent:'researcher',agentConfig:agent,task:'Use proof_side_effect once and return OFFLINE_DETACHED_DONE.',ctx:{pi,cwd:home,currentSessionId:'offline-parent',interactive:false},cwd:home,availableModels:[{provider:'offline-proof',id:'safe',fullId:'offline-proof/safe',contextWindow:128000}],artifactConfig:{enabled:false,includeInput:false,includeOutput:false,includeJsonl:false,includeMetadata:false,cleanupDays:1},shareEnabled:false,maxSubagentDepth:0,timeoutMs:25000,output:false});
 asyncDir=start.details?.asyncDir;
 if(start.isError||!asyncDir)throw new Error(JSON.stringify(start));
 const until=Date.now()+40000; let final;
 while(Date.now()<until){const status=readJSON(path.join(asyncDir,'status.json'));pid=status?.pid??pid;
  if(status&&['complete','failed','stopped','cancelled'].includes(status.state)){final=status;break;}
  await new Promise(r=>setTimeout(r,100));
 }
 if(!final)throw new Error('Detached runner did not reach terminal state: '+JSON.stringify(readJSON(path.join(asyncDir,'status.json'))));
 // Wait for actual process-terminal receipt/exit, not just result publication.
 for(let i=0;i<60;i++){try{if(pid)process.kill(pid,0);else break;}catch{exited=true;break;}await new Promise(r=>setTimeout(r,100));}
 const lines=name=>{try{return fs.readFileSync(path.join(home,name),'utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x));}catch{return [];}};
 const provider=lines('provider-proof.jsonl'),network=lines('network-proof.jsonl');
 console.log('DETACHED_JSON='+JSON.stringify({driverPid:process.pid,pid,exited,proceedConsumed:!fs.existsSync(path.join(asyncDir,'runner-startup-proceed.json')),start,final:readJSON(path.join(asyncDir,'status.json'))??final,provider,network,asyncDir,dirs:DIRS}));
}catch(error){let logs={};if(asyncDir){for(const name of fs.readdirSync(asyncDir)){if(/log$/.test(name))logs[name]=fs.readFileSync(path.join(asyncDir,name),'utf8').slice(-12000);}}console.log('DETACHED_JSON='+JSON.stringify({fatal:String(error.stack),asyncDir,pid,logs}));process.exitCode=1;}
finally{if(pid&&!exited){try{process.kill(pid,'SIGTERM');}catch{}}}
