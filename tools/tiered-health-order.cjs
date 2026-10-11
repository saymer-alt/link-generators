// Изолированный reproducer health/traffic ordering, не штатный CI retry.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.resolve(process.argv[2]||'fieldtest-private/health-order');
assert(fs.statSync(path.join(root,'.git')).isFile(),'Run in an isolated git worktree');
assert(out.includes('fieldtest-private'),'Use fieldtest-private output');fs.mkdirSync(out,{recursive:true});
let base=fs.readFileSync(path.join(root,'tests/tiered-failover-runtime.cjs'),'utf8');
function change(from,to){assert(base.includes(from),'harness anchor changed: '+from);base=base.replace(from,to);}
for(const file of ['observe','ports'])change("require('../tools/tiered-stability/"+file+".cjs')",'require('+JSON.stringify(path.join(root,'tools/tiered-stability',file+'.cjs'))+')');
change("await until(() => s.get('/version'), 'controller startup s1');","await sleep(900); await until(() => s.get('/version'), 'controller startup s1');");
change('try { await fn(); } catch(e)',"try { await fn(); if(label==='A-strict-priority'){clearTimeout(LAB_WATCHDOG);await observer.finish();process.exit(0);} } catch(e)");
assert(base.includes('}, 5);'),'mock response anchor changed');
async function run(persistent){
 const dir=fs.mkdtempSync(path.join(out,persistent?'persistent-':'recover-')),script=path.join(dir,'probe.cjs');
 fs.writeFileSync(script,base.replace('}, 5);',"}, head && name.startsWith('T1') && "+(persistent?'true':'process.uptime()<2')+" ? 800 : 5);"));
 const code=await new Promise((resolve,reject)=>{const child=cp.spawn(process.execPath,[script],{env:{...process.env,TEST_OUTPUT_DIR:dir},windowsHide:true});let log='';for(const stream of [child.stdout,child.stderr])stream.on('data',d=>log=(log+d).slice(-12000));child.on('error',reject);child.on('close',code=>{fs.writeFileSync(path.join(dir,'probe.log'),log);resolve(code);});});
 const d=JSON.parse(fs.readFileSync(path.join(dir,'tiered-diagnostic.json'))),s=d.sessions[0],traffic=d.timeline.filter(e=>e.type==='traffic');
 const row={persistent,code,version:d.version,initialRoot:s.initial?.groups.ROOT.now,initialT1AAlive:s.initial?.leaves.T1A.alive,initialT1BAlive:s.initial?.leaves.T1B.alive,firstBody:traffic[0]?.body,firstT1Ms:s.firstT1Ms,failure:d.failure?.message,last:d.failure?.last,cleanupErrors:d.cleanupErrors};console.log(JSON.stringify(row));return row;
}
(async()=>{const rows=[];for(let i=0;i<3;i++)rows.push(await run(false));rows.push(await run(true));fs.writeFileSync(path.join(out,'health-order-summary.json'),JSON.stringify(rows,null,2));
 assert(rows.every(r=>!r.cleanupErrors.length&&r.initialRoot==='T2'&&/^T2[AB]$/.test(r.firstBody)),'ordering not reproduced');
 assert(rows.slice(0,3).every(r=>r.code===0&&r.firstT1Ms<15000),'recovery failed');
 assert(rows[3].code===1&&rows[3].last===false&&rows[3].failure==='A: traffic via T1','persistent health failure signature not reproduced');
})().catch(e=>{console.error(e);process.exitCode=1;});
