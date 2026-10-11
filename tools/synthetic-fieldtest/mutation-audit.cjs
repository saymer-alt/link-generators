// Контролируемые мутации только в отдельном временном checkout; исходник всегда возвращается.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const root=path.resolve(process.argv[2]||''),out=path.resolve(process.argv[3]||'fieldtest-private/results/mutations');
assert.ok(path.basename(root)==='v111-chaos-mutants','требуется отдельный mutant worktree');
fs.mkdirSync(out,{recursive:true});const file=path.join(root,'index.html'),original=fs.readFileSync(file,'utf8');
const mutants=[
 ['wg-ipv4','field-acceptance-browser.cjs',"if (p.ip !== undefined && (", "if (false && p.ip !== undefined && (",{FIELDTEST_CASE:'router-off'}],
 ['missing-dialer','browser.cjs',"if (dp !== 'DIRECT' && !proxyNames.has(dp) && !groupNames.has(dp)) {","if (false && dp !== 'DIRECT' && !proxyNames.has(dp) && !groupNames.has(dp)) {"],
 ['apply-consent','independent-product-browser.cjs',"if (pending.findings.some(f => f.state !== 'EXACT') && !document.getElementById('rbLossAck')?.checked) return;","/* mutant: consent guard removed */"],
 ['undo-partial','independent-product-browser.cjs',"const snapshot = rbUndoProjectState;","const snapshot = rbUndoProjectState; snapshot.options.webUI = !snapshot.options.webUI;"],
 ['stale-build','browser.cjs',"if (buildSeq !== mihomoValidationSeq) return; // stale: ввод изменился / начата новая сборка","/* mutant: stale publication allowed */"],
 ['source-order','project-roundtrip-browser.cjs',"setOpt('mihomoInput', s.mainInput);","setOpt('mihomoInput', s.mainInput.split('\\n').reverse().join('\\n'));"],
 ['dpr-case','final-release-browser.cjs',"name: namedSlugs[slug] === target ? target : slug.slice('policy-'.length)","name: slug.slice('policy-'.length)"],
 ['secret-redaction','independent-boundaries-browser.cjs',"function csRedactText(value, doc) {","function csRedactText(value, doc) { return String(value || '');"],
 ['gateway-dns-off','independent-reverse-profiles-browser.cjs',"project.options.vpsDnsEnabled = !!(dns && dns.enable === true);","project.options.vpsDnsEnabled = true;"],
 ['project-field-type','independent-boundaries-browser.cjs',"p.options[key] !== undefined && typeof p.options[key] !== 'boolean'","false && p.options[key] !== undefined && typeof p.options[key] !== 'boolean'"]
];
const results=[],controls=new Map();
function run(test,extra={},label){const dest=path.join(out,label);fs.mkdirSync(dest,{recursive:true});const r=spawnSync(process.execPath,[test==='evening-chaos-browser.cjs'?path.join(__dirname,'../../tests',test):path.join(root,'tests',test)],{cwd:root,env:{...process.env,AUDIT_ROOT:root,TEST_OUTPUT_DIR:dest,FIELDTEST_LAB_DIR:'',...extra},encoding:'utf8',timeout:45000,maxBuffer:8*1024*1024});fs.writeFileSync(path.join(dest,'private-runner.log'),(r.stdout||'')+(r.stderr||''));return r;}
try{
 for(const [name,test,from,to,extra={}] of mutants){
  fs.writeFileSync(file,original);assert.equal(original.split(from).length-1,1,name+': anchor must be unique');
  const key=test+JSON.stringify(extra);
  if(!controls.has(key)){const r=run(test,extra,'control-'+name);assert.equal(r.status,0,'unmutated control failed: '+test);controls.set(key,true);}
  fs.writeFileSync(file,original.replace(from,to));
  const r=run(test,extra,name),log=(r.stdout||'')+(r.stderr||'');
  let detected=r.status!==0&&/AssertionError|assert\.|TimeoutError/.test(log),regression=null;
  if(r.status===0&&['missing-dialer','apply-consent'].includes(name)){
   const extraNew={CHAOS_CASE:name==='missing-dialer'?'validator-missing':'reverse-programmatic'};
   fs.writeFileSync(file,original);assert.equal(run('evening-chaos-browser.cjs',extraNew,'new-control-'+name).status,0,'new regression control');
   fs.writeFileSync(file,original.replace(from,to));const next=run('evening-chaos-browser.cjs',extraNew,'new-'+name);
   regression={test:'evening-chaos-browser.cjs',exit:next.status};detected=next.status!==0&&(next.stdout||'').includes('FAIL');
  }
  const entry={mutant:name,test,existingStatus:r.status===0?'SURVIVED':detected?'DETECTED':'HARNESS ERROR',status:detected?'DETECTED':r.status===0?'SURVIVED':'HARNESS ERROR',exit:r.status,termination:r.error?.code||'normal',regression,control:'PASS'};
  results.push(entry);console.log(JSON.stringify(entry));fs.writeFileSync(path.join(out,'mutation-results.json'),JSON.stringify(results,null,2));
 }
}finally{fs.writeFileSync(file,original);assert.equal(fs.readFileSync(file,'utf8'),original);}
process.exitCode=results.some(r=>r.status==='HARNESS ERROR')?1:0;
