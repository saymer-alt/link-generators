// Offline synthetic field acceptance. Never reads owner files; all network is blocked.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {pathToFileURL}=require('node:url'),{spawnSync}=require('node:child_process'),{chromium}=require('playwright');
const yaml=require(process.env.JS_YAML_PATH),crypto=require('node:crypto');
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const same=(a,b,message)=>assert.equal(digest(a),digest(b),message);
const {createLab}=require('../tools/synthetic-fieldtest/generate.cjs');
const ephemeral=!process.env.FIELDTEST_LAB_DIR;
const lab=createLab(process.env.FIELDTEST_LAB_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'lg-field-acceptance-')));
const root=path.resolve(__dirname,'..'),out=lab.dir,cases=process.env.FIELDTEST_CASE?lab.cases.filter(c=>c.id===process.env.FIELDTEST_CASE):lab.cases;
const SUB='https://field.example.invalid/feed';
const VLESS='vless://00000000-0000-4000-8000-000000000091@192.0.2.91:443?type=tcp#SYNTH-VLESS';
const LINKS=[VLESS,'trojan://synthetic-field-only@192.0.2.92:443#SYNTH-TROJAN','ss://'+Buffer.from('aes-128-gcm:synthetic-field-only').toString('base64')+'@192.0.2.93:8443#SYNTH-SS'].join('\n');
const coreResults=[];let baselineProject;
const normalize=text=>text.replace(/^[ \t]+- [0-9a-f]{32}$/gm,'  - <HWID>');
let parseChecks=0;
function parseCore(text,id,valid=true){
 if(!process.env.MIHOMO_BIN)return;
 const file=path.join(out,'generated',id+'.yaml');fs.writeFileSync(file,text);
 const r=spawnSync(process.env.MIHOMO_BIN,['-t','-d',out,'-f',file],{encoding:'utf8',timeout:20000});
 assert.ifError(r.error);assert.equal(r.status===0,valid,id+': unexpected Mihomo parse verdict (values hidden)');parseChecks++;coreResults.push({scenario:id,expected:valid?'ACCEPT':'REJECT',actual:r.status===0?'ACCEPT':'REJECT',status:'PASS'});
}
(async()=>{
 const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
 const results=[];let requests=0;
 async function open(){
  const ctx=await browser.newContext({acceptDownloads:true});
  await ctx.route(/^https?:/,r=>{
   if(r.request().url().startsWith('https://cdn.jsdelivr.net/'))return r.fulfill({path:process.env.JS_YAML_PATH,contentType:'text/javascript'});
   requests++;return r.abort();
  });
  const page=await ctx.newPage();page.setDefaultTimeout(20000);
  page.on('pageerror',()=>{throw new Error('unexpected browser error (values hidden)');});
  await page.goto(pathToFileURL(path.join(root,'index.html')).href);
  await page.waitForFunction(()=>!!web4core&&!!jsyaml);
  await page.evaluate(vless=>{web4core.fetchSubscription=async()=>vless+'\n'+vless.replace('SYNTH-VLESS','SYNTH-EXCLUDED').replace('000091','000094');},VLESS);
  return {ctx,page};
 }
 const snap=page=>page.evaluate(()=>{const p=rbCollectProject();delete p.meta.created;return p;});
 async function build(page,id){
  await page.evaluate(()=>{document.getElementById('mihomoOutput').value='';return buildMihomo();});
  await page.waitForFunction(()=>MIHOMO_VALIDATION_STATE.state!=='VALIDATING');
  assert.equal(await page.evaluate(()=>MIHOMO_VALIDATION_STATE.state),'VALID',id+': Builder rejected synthetic valid case');
  const text=await page.locator('#mihomoOutput').inputValue();
  const unresolved=await page.evaluate(text=>cdgBuildGraph(jsyaml.load(text)).nodes.filter(n=>n.kind==='unresolved').length,text);
  assert.equal(unresolved,0,id+': unresolved graph target');parseCore(text,id);return text;
 }
 async function modify(page,c,id){
  if(c.awl)return; // AWL source loss is reported; no invented fallback URL.
  const before=await snap(page);
  const firstTarget=await page.evaluate(()=>lastRoutingDoc.proxies.find(p=>p.type==='wireguard').name);
  await page.locator('.wg-list-del').last().click();
  await page.fill('#mihomoInput',before.sources.mainInput.replace('/feed','/changed')+'\nhttps://added.example.invalid/feed');
  await page.check('#cfgSubMode');
  await page.uncheck('#cfgWebUI');
  if(c.profile==='router')await page.locator('#cfgTun').setChecked(!before.options.addTun);
  if(c.profile==='vps-gateway')await page.locator('#vpsDnsEnabled').setChecked(!before.options.vpsDnsEnabled);
  await page.evaluate(target=>{wgProfiles[1].mode='proxy';wgProfiles[1].target=target;renderWgList();syncWgCollections();},firstTarget);
  const after=await snap(page);assert.equal(after.wgProfiles.length,before.wgProfiles.length-1);
  same(after.wgProfiles.map(p=>p.bean),before.wgProfiles.slice(0,-1).map(p=>p.bean),id+': edit changed unrelated WG beans');
  for(const key of ['excludeFilter','urlTestPreset','urlTestCustomUrl','vpsDevice','vpsMtu','vpsFakeIp','vpsDnsListen','vpsDnsNs','vpsProxyNs'])same(after.options[key],before.options[key],id+': unrelated option changed');
  same(after.domainPolicy,before.domainPolicy);same(after.tiered,before.tiered);
  await build(page,id+'-edited');
 }
 try{
  for(const c of cases){
   const first=await open(),p=first.page;
   const profileCount=c.profiles||3;
   await p.locator('#wgFile').setInputFiles(lab.profiles.slice(0,profileCount));
   await p.waitForFunction(n=>wgProfiles.length===n,profileCount);
   await p.evaluate(({c,SUB,LINKS})=>{
    const x=rbCollectProject();x.sources.mainInput=c.links?(c.sub?SUB+'\n':'')+LINKS:Array.from({length:c.subs||1},(_,i)=>c.duplicates?SUB:SUB.replace('field.',i?'field'+i+'.':'field.')).join('\n');
    if(c.unicode)x.sources.mainInput=x.sources.mainInput.replace('SYNTH-VLESS','Тест_日本_🌐');x.sources.subMode=c.sub;
    x.sources.autoWhitelist=!!c.awl;x.sources.fallbackInput=c.awl?'https://fallback.example.invalid/feed':'';
    Object.assign(x.options,{profile:c.profile,addTun:c.stack!=='off',tunMips:c.stack==='mips',tunStackAdvanced:c.stack==='system',tunStackEx:c.stack==='system'?'system':'gvisor',addSocks:true,lan:c.profile==='router',webUI:true,webUiDashboard:c.dashboard||'yacd',urlTestPreset:'__custom__',urlTestCustomUrl:'https://health.example.invalid/204',excludeFilter:'EXCLUDED',vpsDnsEnabled:!!c.dns,vpsDevice:'tun-field',vpsMtu:'1340',vpsFakeIp:'198.19.0.0/16',vpsDnsListen:'127.0.0.1:1053',vpsDnsNs:'192.0.2.53',vpsProxyNs:'192.0.2.54'});
    if(c.policy)x.domainPolicy={enabled:true,cards:[{name:'field',domains:'field.example.invalid',target:'GLOBAL'}]};
    if(c.tiered)x.tiered={enabled:true,cards:[{name:'main',strategy:'url-test',members:['⚡ Fastest']}]};
    if(c.perProxy)Object.assign(x.options,{perProxyMaster:true,perProxyTun:true,perProxySocks:true});
    if(c.dialer){x.wgProfiles[2].mode='proxy';x.wgProfiles[2].target='SYNTH-VLESS';}
    rbApplyProject(x);
   },{c,SUB,LINKS});
   if(c.serverList){await p.check('#cfgServerList');await p.click('#subListFetchBtn');await p.waitForFunction(()=>subscriptionListNames.length===2);await p.evaluate(()=>{subscriptionSelection.add('SYNTH-EXCLUDED');renderServerList();});}
   if(c.chain){await build(p,c.id+'-preflight');await p.evaluate(()=>{const names=lastRoutingDoc.proxies.filter(p=>p.type==='wireguard').map(p=>p.name);for(let i=1;i<3;i++){wgProfiles[i].mode='proxy';wgProfiles[i].target=names[i-1];}renderWgList();syncWgCollections();});}
   const expected=await snap(p);baselineProject=baselineProject||expected;const original=await build(p,c.id+'-original');
   const [dl]=await Promise.all([p.waitForEvent('download'),p.locator('button[onclick="rbSaveProject()"]').click()]);
   const projectFile=path.join(out,'generated',c.id+'.lgproject.json');await dl.saveAs(projectFile);
   const second=await open(),q=second.page,empty=await snap(q);let accept=false,previews=0;
   q.on('dialog',async d=>{assert.ok(d.message().includes('Предпросмотр проекта'));previews++;if(accept)await d.accept();else await d.dismiss();});
   await q.locator('#rbProjectFile').setInputFiles(projectFile);await q.waitForFunction(()=>document.getElementById('toast').textContent.includes('отменена'));
   same(await snap(q),empty,c.id+': Load Cancel mutated Builder');accept=true;
   await q.locator('#rbProjectFile').setInputFiles([]);await q.locator('#rbProjectFile').setInputFiles(projectFile);
   await q.waitForFunction(()=>document.getElementById('toast').textContent.includes('Проект загружен'));
   assert.equal(previews,2);same(await snap(q),expected,c.id+': project state drift');
   const rebuilt=await build(q,c.id+'-project');same(normalize(rebuilt),normalize(original),c.id+': project YAML drift');
   await modify(q,c,c.id+'-project');
   await q.evaluate(()=>rbUndoRestore());same(await snap(q),empty,c.id+': project Undo drift');
   let reverseInput=original;
   if(c.unknown||c.serverYaml){const d=yaml.load(original);d['x-synthetic-evidence']={nested:['preserved-only-in-project']};if(c.serverYaml){d['proxy-groups']=[{name:'SERVER-ONLY',type:'select',proxies:['DIRECT',...d.proxies.map(p=>p.name)]}];d.rules=['DOMAIN-SUFFIX,example.invalid,SERVER-ONLY','MATCH,DIRECT'];d.sniffer={enable:false,'force-domain':['+.example.invalid']};}reverseInput=yaml.dump(d);parseCore(reverseInput,c.id+'-input');fs.writeFileSync(path.join(out,'fixtures','reverse-build',c.id+'.yaml'),reverseInput);}
   await q.locator('.tab',{hasText:'Config Studio'}).click();await q.fill('#csImportInput',reverseInput);await q.click('#csParseBtn');
   const dnsSnapshot=await q.evaluate(()=>typeof csDnsRoutingText==='function'?{actual:document.getElementById('csDnsRoutingOut').textContent,expected:csDnsRoutingText(csCurrentDoc)}:null);
   if(dnsSnapshot)same(dnsSnapshot.actual,dnsSnapshot.expected,c.id+': DNS snapshot stale after Parse');
   same(await q.locator('#csImportInput').inputValue(),reverseInput,c.id+': Studio/DNS mutated YAML');
   const before=await snap(q);await q.click('#csRestoreBtn');same(await snap(q),before,c.id+': Reverse Preview mutated Builder');
   const analysis=await q.evaluate(text=>rbYamlToProject(jsyaml.load(text)),reverseInput);
   same(analysis.project.passthrough['source-config'],yaml.load(reverseInput),c.id+': source evidence lost');
   const blocked=analysis.findings.some(f=>['CONFLICT','INVALID'].includes(f.state));
   if(c.dialer)assert.ok(analysis.findings.some(f=>f.state==='CONFLICT'&&f.field.endsWith('.dialer-proxy')),'omitted static dialer target must block Restore');
   const labels=await q.evaluate(()=>['toast','csStatus','csSummary','csDiagOut','csGraphOut','csTraceOut','csRestoreOut','csVrgTextAltOut'].map(id=>document.getElementById(id)?.textContent||'').join('\n'));
   for(const w of expected.wgProfiles)assert.ok(!labels.includes(w.bean.wireguard.privateKey),'private key appeared in UI diagnostics');
   await q.click('#rbCancelRestoreBtn');same(await snap(q),before,c.id+': Reverse Cancel drift');
   let reverseParity=null;
   if(!blocked&&!c.awl){
    await q.click('#csRestoreBtn');await q.check('#rbLossAck');await q.click('#rbConfirmRestoreBtn');
    if(c.perProxy){await q.evaluate(()=>buildMihomo());await q.waitForFunction(()=>MIHOMO_VALIDATION_STATE.state!=='VALIDATING');assert.equal(await q.evaluate(()=>MIHOMO_VALIDATION_STATE.state),'NOT_BUILT','omitted per-proxy inbounds need an explicit replacement');await q.check('#cfgSocks');}
    const reversed=await build(q,c.id+'-reverse');reverseParity=normalize(reversed)===normalize(reverseInput);
    if(!c.links&&!c.awl&&c.sub&&!c.serverList&&!c.unknown&&!c.serverYaml)assert.ok(reverseParity,c.id+': generated subset reverse drift');
    if(c.links||!c.sub)assert.ok(analysis.findings.some(f=>['UNSUPPORTED','MISSING'].includes(f.state)),c.id+': silent source loss');
    await modify(q,c,c.id+'-reverse');
    await q.evaluate(()=>rbUndoRestore());same(await snap(q),before,c.id+': Reverse Undo drift');
   }else if(blocked){await q.click('#csRestoreBtn');assert.ok(await q.locator('#rbConfirmRestoreBtn').isDisabled());}
   else assert.ok(analysis.findings.some(f=>f.state==='MISSING'&&f.field==='sources.fallbackInput'),'AWL missing source must be explicit');
   results.push({case:c.id,parameters:c,status:'PASS',webValidation:'VALID',project:'PASS',dnsSnapshot:dnsSnapshot?'PASS':'NOT PRESENT MAIN',manualInbound:!!c.perProxy,reverse:blocked?'BLOCKED_CONFLICT':c.awl?'UNSUPPORTED_MISSING_FALLBACK':reverseParity?'PARITY':'EXPLICIT_LIMITS',states:[...new Set(analysis.findings.map(f=>f.state))]});
   fs.writeFileSync(path.join(out,'results','partial.json'),JSON.stringify({cases:results,coreResults},null,2));
   console.log('PASS field case '+c.id+' project; reverse '+results.at(-1).reverse);
   await first.ctx.close();await second.ctx.close();
  }
  const negative={ 'mixed-port':7890,proxies:[{name:'A',type:'ss',server:'192.0.2.1',port:443,cipher:'aes-128-gcm',password:'synthetic'}],'proxy-groups':[{name:'G',type:'select',proxies:['MISSING']}],rules:['MATCH,G']};
  const duplicate={...negative,'proxy-groups':[],proxies:[negative.proxies[0],negative.proxies[0]],rules:['MATCH,DIRECT']};
  const badKey={...negative,'proxy-groups':[],proxies:[{name:'W',type:'wireguard',server:'192.0.2.1',port:51820,ip:'10.1.0.2','private-key':'invalid','public-key':'invalid'}],rules:['MATCH,DIRECT']};
  const cycle={...negative,'proxy-groups':[{name:'G',type:'select',proxies:['H']},{name:'H',type:'select',proxies:['G']} ]};
  const unknownProvider={...negative,'proxy-groups':[],rules:['RULE-SET,MISSING,DIRECT','MATCH,DIRECT']};
  for(const [id,text] of [['invalid-key',yaml.dump(badKey)],['duplicate-proxy',yaml.dump(duplicate)],['missing-target',yaml.dump(negative)],['route-cycle',yaml.dump(cycle)],['unknown-rule-provider',yaml.dump(unknownProvider)],['malformed-yaml','mixed-port: [']]){
   const x=await open(),before=await snap(x.page);
   await x.page.evaluate(text=>csRunAnalysis(text),text);
   same(await snap(x.page),before,id+': Studio damaged Builder');
   if(id==='malformed-yaml')assert.match(await x.page.locator('#csStatus').textContent(),/^✖/);
   parseCore(text,id,false);results.push({case:id,status:'PASS',expected:'REJECT',webValidation:id==='malformed-yaml'?'IMPORT_REJECT':'STUDIO_DIAGNOSTICS_ONLY',core:process.env.MIHOMO_BIN?'REJECT':'NOT RUN',project:'NOT APPLICABLE',reverse:'NOT APPLICABLE'});await x.ctx.close();
  }
  for(const id of ['project-newer-schema','project-malformed-json','project-wrong-type','project-duplicate-id']){
   const x=await open(),before=await snap(x.page),project=JSON.parse(JSON.stringify(baselineProject));
   if(id==='project-newer-schema')project.schemaVersion=999;
   if(id==='project-wrong-type')project.options.addTun='false';
   if(id==='project-duplicate-id')project.wgProfiles[1].id=project.wgProfiles[0].id;
   const file=path.join(out,'fixtures','invalid',id+'.json');fs.writeFileSync(file,id==='project-malformed-json'?'{"password":"SYNTH-INVALID-JSON",':JSON.stringify(project));
   await x.page.locator('#rbProjectFile').setInputFiles(file);await x.page.waitForFunction(()=>document.getElementById('toast').textContent.includes('❌'));
   same(await snap(x.page),before,id+': invalid project mutated Builder');
   assert.ok(!(await x.page.locator('#toast').textContent()).includes('SYNTH-INVALID-JSON'));
   results.push({case:id,status:'PASS',expected:'REJECT_WITHOUT_MUTATION',webValidation:'IMPORT_REJECT',core:'NOT APPLICABLE',project:'REJECT',reverse:'NOT APPLICABLE'});await x.ctx.close();
  }
  for(const id of ['builder-empty','builder-invalid-uri']){
   const x=await open();await x.page.fill('#mihomoInput',id==='builder-empty'?'':'vless://invalid');await x.page.uncheck('#cfgSubMode');
   const before=await snap(x.page);await x.page.evaluate(()=>buildMihomo());await x.page.waitForFunction(()=>MIHOMO_VALIDATION_STATE.state!=='VALIDATING');
   const state=await x.page.evaluate(()=>MIHOMO_VALIDATION_STATE.state);assert.notEqual(state,'VALID',id+': invalid input accepted');same(await snap(x.page),before);
   results.push({case:id,status:'PASS',expected:'NO_VALID_BUILD',webValidation:state,core:'NOT APPLICABLE',project:'NOT APPLICABLE',reverse:'NOT APPLICABLE'});await x.ctx.close();
  }
  for(const [id,key] of [['wg-missing-address','Address'],['wg-missing-key','PrivateKey'],['wg-missing-endpoint','Endpoint']]){
   const x=await open(),before=await snap(x.page),file=path.join(out,'fixtures','invalid',id+'.conf');
   const text=fs.readFileSync(lab.profiles[0],'utf8').split(/\r?\n/).filter(line=>!line.startsWith(key+' =')).join('\n');fs.writeFileSync(file,text);
   await x.page.locator('#wgFile').setInputFiles(file);await x.page.waitForFunction(()=>!wgUploadPending);
   assert.equal(await x.page.evaluate(()=>wgProfiles.length),0,id+': malformed profile admitted');same(await snap(x.page),before);
   results.push({case:id,status:'PASS',expected:'UPLOAD_REJECT',webValidation:'UPLOAD_REJECT',core:'NOT APPLICABLE',project:'NOT APPLICABLE',reverse:'NOT APPLICABLE'});await x.ctx.close();
  }
  for(const [id,key,value] of [['wg-invalid-address','Address','999.999.999.999/999'],['wg-invalid-endpoint','Endpoint','192.0.2.10:70000'],['wg-invalid-key','PrivateKey','invalid']]){
   const x=await open(),file=path.join(out,'fixtures','invalid',id+'.conf');
   const text=fs.readFileSync(lab.profiles[0],'utf8').split(/\r?\n/).map(line=>line.startsWith(key+' =')?key+' = '+value:line).join('\n');fs.writeFileSync(file,text);
   await x.page.locator('#wgFile').setInputFiles(file);await x.page.waitForFunction(()=>!wgUploadPending);
   let actual='UPLOAD_REJECT';
   if(await x.page.evaluate(()=>wgProfiles.length)){
    await x.page.uncheck('#cfgSubMode');const before=await snap(x.page);await x.page.evaluate(()=>buildMihomo());await x.page.waitForFunction(()=>MIHOMO_VALIDATION_STATE.state!=='VALIDATING');
    actual=await x.page.evaluate(()=>MIHOMO_VALIDATION_STATE.state);assert.notEqual(actual,'VALID',id+': invalid WG admitted to valid build');same(await snap(x.page),before);
    const text=await x.page.locator('#mihomoOutput').inputValue();if(text)parseCore(text,id+'-core',id==='wg-invalid-endpoint');
   }
   results.push({case:id,status:'PASS',expected:'NO_VALID_BUILD',webValidation:actual,core:'NOT APPLICABLE',project:'NOT APPLICABLE',reverse:'NOT APPLICABLE'});await x.ctx.close();
  }
  for(const id of ['deleted-dialer-target','dialer-cycle']){
   const x=await open();await x.page.evaluate(project=>rbApplyProject(project),baselineProject);await build(x.page,id+'-preflight');
   const names=await x.page.evaluate(()=>lastRoutingDoc.proxies.filter(p=>p.type==='wireguard').map(p=>p.name));
   for(const i of id==='dialer-cycle'?[0,1]:[1]){
    await x.page.locator('.wg-mode').nth(i).selectOption('proxy');
    const profileId=await x.page.evaluate(i=>wgProfiles[i].id,i);
    await x.page.locator('#wgTarget'+profileId).selectOption('__manual__');
    await x.page.locator('.wg-target-manual').nth(i).fill(id==='dialer-cycle'?names[1-i]:'MISSING');
    await x.page.locator('.wg-target-manual').nth(i).evaluate(el=>el.dispatchEvent(new Event('change',{bubbles:true})));
   }
   const before=await snap(x.page);await x.page.evaluate(()=>buildMihomo());await x.page.waitForFunction(()=>MIHOMO_VALIDATION_STATE.state!=='VALIDATING');const actual=await x.page.evaluate(()=>MIHOMO_VALIDATION_STATE.state);
   assert.notEqual(actual,'VALID',id+': invalid dialer accepted');same(await snap(x.page),before);
   results.push({case:id,status:'PASS',expected:'NO_VALID_BUILD',webValidation:actual,core:'NOT APPLICABLE',project:'NOT APPLICABLE',reverse:'NOT APPLICABLE'});await x.ctx.close();
  }
  for(const r of results){r.expected=r.expected||'VALID_BUILD_EXACT_PROJECT_LOSS_AWARE_REVERSE';r.actual=r.actual||r.webValidation;r.parameters=r.parameters||{inputClass:r.case};r.mihomo=coreResults.filter(c=>c.scenario===r.case||c.scenario.startsWith(r.case+'-'));if(!r.mihomo.length)r.mihomo='NOT APPLICABLE / NOT RUN';}
  assert.equal(requests,0,'unexpected external request was attempted');
  if(process.env.TEST_OUTPUT_DIR){fs.mkdirSync(process.env.TEST_OUTPUT_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.TEST_OUTPUT_DIR,'field-acceptance-results.json'),JSON.stringify({cases:results,coreResults,parseChecks,externalRequests:requests},null,2));}
  fs.writeFileSync(path.join(out,'results','results.json'),JSON.stringify({seed:lab.seed,cases:results,coreResults,parseChecks,externalRequests:requests},null,2));
  console.log('PASS field-acceptance-browser: '+results.length+' cases; Mihomo parse checks '+parseChecks+'; external requests 0');
 }finally{await browser.close();if(ephemeral){assert.equal(path.dirname(out),path.resolve(os.tmpdir()));fs.rmSync(out,{recursive:true,force:true});}}
})().catch(e=>{console.error(e);process.exitCode=1;});
