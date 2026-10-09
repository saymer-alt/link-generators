// Ограниченная серия независимых запусков; failures считаются, не перезапускаются.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
const count=Number(process.argv[2]||20),out=path.resolve(process.argv[3]||'fieldtest-private/tiered-series');
if(!Number.isInteger(count)||count<1||count>20)throw Error('count must be 1..20');
fs.mkdirSync(out,{recursive:true});
function stats(values){const a=values.filter(Number.isFinite).sort((a,b)=>a-b);return a.length?{n:a.length,min:a[0],median:a[Math.floor(a.length/2)],p95:a[Math.ceil(a.length*.95)-1],max:a.at(-1)}:null;}
function run(dir,mode='') { return new Promise(resolve=>{
  const child=spawn(process.execPath,[path.resolve(__dirname,'../../tests/tiered-failover-runtime.cjs')],{env:{...process.env,TEST_OUTPUT_DIR:dir,TIERED_EXPERIMENT:mode},windowsHide:true});
  let tail=''; for(const stream of [child.stdout,child.stderr])stream.on('data',d=>tail=(tail+d).slice(-12000));
  child.on('error',e=>resolve({code:null,error:e.message}));
  child.on('close',(code,signal)=>{fs.writeFileSync(path.join(dir,'lab.log'),tail);let diagnostic;try{diagnostic=JSON.parse(fs.readFileSync(path.join(dir,'tiered-diagnostic.json')));}catch{}resolve({code,signal,diagnostic});});
}); }
(async()=>{
  const rows=[];
  for(let i=0;i<count;i++){
    const dir=fs.mkdtempSync(path.join(out,'run-')),r=await run(dir,process.env.TIERED_EXPERIMENT||'');
    const d=r.diagnostic,s=d?.sessions[0]; rows.push({run:i+1,dir:path.basename(dir),code:r.code,status:d?.status||'NO_DIAGNOSTIC',version:d?.version,controllerMs:s?.controllerMs,firstT1Ms:s?.firstT1Ms,initialRoot:s?.initial?.groups.ROOT.now,failure:d?.failure,cleanupErrors:d?.cleanupErrors,connectionErrors:d?.waits.map(w=>w.errors)});
    fs.writeFileSync(path.join(out,'runs.json'),JSON.stringify(rows,null,2)); console.log(`${i+1}/${count} ${rows.at(-1).status} controller=${s?.controllerMs} T1=${s?.firstT1Ms}`);
  }
  const failed=rows.filter(r=>r.status!=='PASS'||r.code!==0).length;
  const summary={platform:os.platform(),arch:os.arch(),total:count,passed:count-failed,failed,failureRate:failed/count,controllerMs:stats(rows.map(r=>r.controllerMs)),firstT1Ms:stats(rows.map(r=>r.firstT1Ms)),initialRootNotT1:rows.filter(r=>r.initialRoot&&r.initialRoot!=='T1').length,versions:[...new Set(rows.map(r=>r.version))]};
  fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));process.exitCode=failed?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
