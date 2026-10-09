// Наблюдение за loopback lab: GET controller не запускает активные health probes.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { execFileSync } = require('node:child_process');
const started = Date.now(), sessions = [], mocks = [], servers = [], timeline = [], waits = [];
let version, lastSuccess, lastFailure, failure, finishing;
const error = e => ({ name: e.name, message: e.message, code: e.code || e.cause?.code });
function event(type, data = {}) { timeline.push({ ms: Date.now() - started, type, ...data }); if (timeline.length > 2000) timeline.shift(); }
function probe(port) { return new Promise(resolve => { const s = net.connect({host:'127.0.0.1',port}); let done=false; const end = value => { if(done)return; done=true; s.destroy(); resolve(value); }; s.setTimeout(300,()=>end({ready:false,code:'TIMEOUT'})); s.on('connect',()=>end({ready:true})); s.on('error',e=>end({ready:false,...error(e)})); }); }
async function snapshot(s) {
  const state = { label:s.label, pid:s.child.pid, exitCode:s.child.exitCode, signal:s.child.signalCode, spawnError:s.spawnError,
    control:s.control, mixed:s.mixed, ageMs:Date.now()-s.started, stopped:!!s.stopped, mixedState:await probe(s.mixed), groups:{} };
  for (const name of ['ROOT','T1','T2','T3']) { try { state.groups[name] = await s.get('/proxies/'+name); } catch(e) { state.groups[name]={error:error(e)}; } }
  try { state.leaves = (await s.get('/proxies')).proxies; } catch(e) { state.controllerError=error(e); }
  state.logTail=s.logs().split(/\r?\n/).slice(-80); state.startupLog=s.startupLog; state.errorLines=s.errorLines;
  return state;
}
function addSession(s) {
  const stale=sessions.find(previous=>!previous.stopped && previous.child.exitCode===null && previous.child.signalCode===null);
  s.started=Date.now(); s.label=path.basename(s.dir); sessions.push(s); event('spawn',{label:s.label,pid:s.child.pid,control:s.control,mixed:s.mixed});
  s.child.on('error',e=>{s.spawnError=error(e); event('spawn-error',s.spawnError);});
  s.child.on('exit',(code,signal)=>event('exit',{pid:s.child.pid,code,signal}));
  if(stale)throw Error('STALE_PROCESS '+stale.child.pid);
}
async function controller(s,route,value) {
  if(route==='/version' && !s.controllerMs) { s.controllerMs=Date.now()-s.started; s.initial=await snapshot(s); event('controller-ready',{pid:s.child.pid,latencyMs:s.controllerMs,root:s.initial.groups.ROOT.now}); }
  return value;
}
function traffic(s,t0,body,e) {
  const value={ms:Date.now()-started,label:s.label,durationMs:Date.now()-t0,body:body?.slice(0,100),error:e&&error(e)};
  event('traffic',value); if(e || !/^T[123][AB]$/.test(body)) lastFailure=value; else lastSuccess=value;
  if(/^T1[AB]$/.test(body) && s.firstT1Ms===undefined) s.firstT1Ms=Date.now()-s.started;
}
function classify(data) {
  const labels=[];
  if(!data.failure)return labels;
  for(const s of data.failure?.sessions||[]) {
    if(!s.stopped && (s.spawnError || s.exitCode!==null || s.signal)) labels.push('CORE_EXIT');
    if(!s.stopped && s.controllerError) labels.push('CONTROLLER_NOT_READY');
    if(!s.stopped && !s.mixedState.ready) labels.push('MIXED_NOT_READY');
    if(s.groups.ROOT?.now && s.groups.ROOT.now!=='T1') labels.push('ROOT_NOT_T1');
    if(s.groups.ROOT?.now==='T1' && data.failure) labels.push('T1_NO_EXPECTED_TRAFFIC');
    if([...(s.logTail||[]),...(s.errorLines||[])].some(line=>/address already in use|access permissions|server error: listen/i.test(line)))labels.push('BIND_ERROR');
  }
  for(const m of data.mocks||[]) { if(!m.alive)labels.push(m.name+'_DOWN'); if(!m.health?.length)labels.push(m.name+'_HEALTH_NOT_OBSERVED'); }
  if(data.lastFailure?.error)labels.push(data.lastFailure.error.code||data.lastFailure.error.message);
  else if(data.lastFailure?.body!==undefined)labels.push('UNEXPECTED_RESPONSE');
  if(data.failure?.message?.includes('STALE_PROCESS'))labels.push('STALE_PROCESS');
  return [...new Set(labels)];
}
async function until(fn,message,budget=15000) {
  const t0=Date.now(), end=t0+budget, w={message,budget,attempts:0,errors:{}}; waits.push(w); let last;
  while(Date.now()<end) { w.attempts++; try { last=await fn(); if(last) { w.durationMs=Date.now()-t0; return last; } } catch(e) { w.lastError=error(e); const key=e.code||e.cause?.code||e.message; w.errors[key]=(w.errors[key]||0)+1; } await new Promise(r=>setTimeout(r,100)); }
  w.durationMs=Date.now()-t0; w.last=last; failure={message,last,lastError:w.lastError};
  // Состояние сохраняется до finally/остановки core; исходный бюджет не меняется.
  failure.sessions=await Promise.all(sessions.map(snapshot));
  throw Error(message+': last='+JSON.stringify(last)+(w.lastError?' lastError='+JSON.stringify(w.lastError):''));
}
async function stop(s) {
  if(s.stopped)return;
  if(s.child.exitCode===null && s.child.signalCode===null && s.child.pid) {
    const closed=new Promise(resolve=>{ s.child.once('close',resolve); });
    if(process.platform==='win32') { try { execFileSync('taskkill',['/pid',String(s.child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true}); } catch {} } else s.child.kill();
    let timer,deadline;
    try { await Promise.race([closed,new Promise((resolve,reject)=>{timer=setTimeout(()=>{s.child.kill('SIGKILL');},3000);deadline=setTimeout(()=>reject(Error('CLEANUP_PROCESS_ALIVE '+s.child.pid)),5000);})]); }
    finally { clearTimeout(timer); clearTimeout(deadline); }
  }
  fs.writeFileSync(path.join(s.dir,'mihomo.log'),s.logs());
  s.released={control:await probe(s.control),mixed:await probe(s.mixed)}; event('stopped',{pid:s.child.pid,released:s.released});
  if(s.child.exitCode===null && s.child.signalCode===null && !s.spawnError) throw Error('CLEANUP_PROCESS_ALIVE '+s.child.pid);
  if(s.released.control.ready||s.released.mixed.ready) throw Error('CLEANUP_PORT_BUSY '+s.label);
  s.stopped=true;
}
async function finish(e) {
  if(finishing)return finishing;
  finishing=(async()=>{
    const cleanupErrors=[];
    if(e && !failure) failure={message:e.message,sessions:await Promise.all(sessions.map(snapshot))};
    for(const s of sessions)try{await stop(s);}catch(err){cleanupErrors.push(error(err));}
    for(const m of mocks)for(const socket of m.sockets)socket.destroy();
    for(const server of servers) { server.closeAllConnections?.(); if(server.listening) await new Promise(r=>server.close(r)); }
    const data={version,startedAt:new Date(started).toISOString(),platform:process.platform,arch:process.arch,node:process.version,status:e||cleanupErrors.length?'FAIL':'PASS',failure,cleanupErrors,
      sessions:sessions.map(s=>({label:s.label,pid:s.child.pid,controllerMs:s.controllerMs,firstT1Ms:s.firstT1Ms,initial:s.initial,exitCode:s.child.exitCode,signal:s.child.signalCode,released:s.released})),
      mocks:mocks.map(m=>({name:m.name,port:m.port,alive:m.alive,attempts:m.attempts,requests:m.requests,connects:m.connects,rejected:m.rejected,health:m.health,sockets:m.sockets.size})),lastSuccess,lastFailure,waits,timeline};
    data.classification=classify(data);
    fs.writeFileSync(path.join(process.env.TEST_OUTPUT_DIR,'tiered-diagnostic.json'),JSON.stringify(data,null,2)); return data;
  })(); return finishing;
}
module.exports={event,error,until,addSession,controller,traffic,stop,finish,mocks,servers,classify,setVersion:v=>{version=v;}};
