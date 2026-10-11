// Мутации создаются только в отдельном ignored каталоге, исходный harness не меняется.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'../..'), out=path.resolve(process.argv[2]||'fieldtest-private/tiered-faults');
assert(fs.statSync(path.join(root,'.git')).isFile(),'Run fault mutations in an isolated git worktree');
if(!out.includes('fieldtest-private'))throw Error('Use isolated fieldtest-private output');
fs.mkdirSync(out,{recursive:true});
const base=fs.readFileSync(path.join(root,'tests/tiered-failover-runtime.cjs'),'utf8').replace("require('../tools/tiered-stability/observe.cjs')",'require('+JSON.stringify(path.join(__dirname,'observe.cjs'))+')').replace("require('../tools/tiered-stability/ports.cjs')",'require('+JSON.stringify(path.join(__dirname,'ports.cjs'))+')');
function replace(source,from,to){assert(source.includes(from),'mutation anchor missing: '+from);return source.replace(from,to);}
const definitions=[
  ['no-start',s=>replace(s,"['-d', dir, '-f', config]","['--invalid-lab-flag']"),'CORE_EXIT'],
  ['controller-no-mixed',s=>replace(s,"'mixed-port': mixed","'mixed-port': 0"),'MIXED_NOT_READY'],
  ['root-not-t1',s=>replace(s,"group('ROOT', 'fallback', ['T1', 'T2', 'T3'])","group('ROOT', 'fallback', ['T2', 'T1', 'T3'])"),'ROOT_NOT_T1'],
  ['t1-no-traffic',s=>replace(s,"const body = head ? '' : name;","if(!head && name.startsWith('T1') && !request.includes('/health'))return; const body=head?'':name;"),'T1_NO_EXPECTED_TRAFFIC'],
  ['one-broken',s=>replace(s,"const [t1a, t1b, t2a, t2b, t3a] = mocks;","const [t1a, t1b, t2a, t2b, t3a] = mocks; t1a.setAlive(false);"),'PASS'],
  ['both-broken',s=>replace(s,"const [t1a, t1b, t2a, t2b, t3a] = mocks;","const [t1a, t1b, t2a, t2b, t3a] = mocks; t1a.setAlive(false); t1b.setAlive(false);"),'ROOT_NOT_T1'],
  ['unexpected-response',s=>replace(s,"const body = head ? '' : name;","const body = head ? '' : request.includes('/health')?name:'UNEXPECTED';"),'UNEXPECTED_RESPONSE'],
  ['late-health',s=>replace(s,"}, 5);","}, request.includes('/health') && process.uptime()<2 ? 800 : 5);"),'PASS'],
  ['core-crash',s=>replace(s,"observer.addSession(s); return s;","observer.addSession(s); if(label==='s1-urltest')setTimeout(()=>child.kill('SIGKILL'),20); return s;"),'CORE_EXIT'],
  ['old-process',s=>replace(s,"} finally { await stopSession(s2); }","} finally { /* deliberately leaked restart child */ }"),'STALE_PROCESS'],
  ['cold-immediate',s=>replace(s,"observer.addSession(s); return s;","observer.addSession(s); try{await requestThrough(mixed);}catch(e){observer.event('cold-immediate-error',observer.error(e));} return s;"),'PASS'],
  ['mock-start-late',s=>replace(s,"const [t1a, t1b, t2a, t2b, t3a] = mocks;","const [t1a, t1b, t2a, t2b, t3a] = mocks; for(const m of mocks){await new Promise(r=>m.server.close(r));setTimeout(()=>m.server.listen(m.port,'127.0.0.1'),1200);}"),'PASS'],
  ['bounded-contention',s=>replace(s,"const sleep = ms =>", "const pressure=setInterval(()=>{const end=Date.now()+80;while(Date.now()<end){}},200);setTimeout(()=>clearInterval(pressure),2500); const sleep = ms =>"),'PASS'],
  ['transient-reset',s=>replace(s,"node.attempts++;","node.attempts++; if(name==='T1A' && node.attempts<3){socket.destroy();return;}"),'PASS'],
  ['delayed-response',s=>replace(s,"}, 5);","}, 100);"),'PASS'],
  ['explicit-target-host',s=>replace(s,"agent: false }, res =>","agent: false, headers:{Host:'127.0.0.1:18080'} }, res =>"),'PASS']
];
async function run([name,mutate,expected]) {
  const dir=fs.mkdtempSync(path.join(out,name+'-')),script=path.join(dir,'mutant.cjs'); fs.writeFileSync(script,mutate(base));
  const result=await new Promise(resolve=>{const child=spawn(process.execPath,[script],{env:{...process.env,TEST_OUTPUT_DIR:dir},windowsHide:true});let log='';child.stdout.on('data',d=>log=(log+d).slice(-12000));child.stderr.on('data',d=>log=(log+d).slice(-12000));child.on('close',code=>{fs.writeFileSync(path.join(dir,'lab.log'),log);resolve({code});});});
  const d=JSON.parse(fs.readFileSync(path.join(dir,'tiered-diagnostic.json')));let detected=expected==='PASS'?result.code===0:d.classification.includes(expected)&&result.code!==0;
  const healthMaxMs=Math.max(0,...d.timeline.filter(e=>e.type==='health-response').map(e=>e.latencyMs));
  if(name==='late-health')detected=detected&&healthMaxMs>=700;
  const row={name,expected,detected,code:result.code,status:d.status,classification:d.classification,healthMaxMs,initial:d.sessions[0]?.initial,firstT1Ms:d.sessions[0]?.firstT1Ms,cold:d.timeline.filter(e=>e.type==='cold-immediate-error'),cleanupErrors:d.cleanupErrors,sockets:d.mocks.map(m=>m.sockets),released:d.sessions.map(s=>s.released)};console.log(JSON.stringify({...row,initial:undefined}));return row;
}
(async()=>{const chosen=process.env.TIERED_CASE?definitions.filter(d=>d[0]===process.env.TIERED_CASE):definitions;assert(chosen.length,'unknown TIERED_CASE');const rows=[];for(let i=0;i<chosen.length;i+=2)rows.push(...await Promise.all(chosen.slice(i,i+2).map(run)));fs.writeFileSync(path.join(out,'fault-summary.json'),JSON.stringify(rows,null,2));assert(rows.every(r=>r.detected&&!r.cleanupErrors.length&&r.sockets.every(n=>n===0)),'fault detection/cleanup failed');})().catch(e=>{console.error(e);process.exitCode=1;});
