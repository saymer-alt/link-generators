// Offline release journey and layout matrix; only synthetic fixtures, no live peers.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url'),pw=require('playwright');
const yaml=require(process.env.JS_YAML_PATH),{createLab}=require('../tools/synthetic-fieldtest/generate.cjs');
const root=process.env.AUDIT_ROOT||path.resolve(__dirname,'..'),engine=process.env.BROWSER_ENGINE||'chromium';
const ephemeral=!process.env.FIELDTEST_LAB_DIR,lab=createLab(process.env.FIELDTEST_LAB_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'lg-final-ui-')));
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const same=(a,b,msg)=>assert.equal(hash(a),hash(b),msg);
const normalized=s=>s.replace(/^[ \t]+- [0-9a-f]{32}$/gm,'  - <HWID>');
const widths=[320,360,375,390,412,480,768,1024,1366,1440,1920,2560];
(async()=>{
 const browser=await pw[engine].launch({headless:true,...(engine==='chromium'?{channel:process.env.BROWSER_CHANNEL||'msedge'}:{})});
 const result={engine,channel:process.env.BROWSER_CHANNEL||null,widths,layouts:[],journey:false,keyboard:false,accessibility:'focused controls only; not a WCAG certification',network:'NOT TESTED',externalRequests:0};
 const errors=[],logs=[];let accept=false;
 try{
  const ctx=await browser.newContext({acceptDownloads:true,viewport:{width:1366,height:900}});
  await ctx.route(/^https?:/,r=>r.request().url().startsWith('https://cdn.jsdelivr.net/')?r.fulfill({path:process.env.JS_YAML_PATH,contentType:'text/javascript'}):(result.externalRequests++,r.abort()));
  const p=await ctx.newPage();p.setDefaultTimeout(25000);
  p.on('pageerror',()=>errors.push('pageerror'));p.on('console',m=>logs.push(m.text()));
  p.on('dialog',async d=>accept?d.accept():d.dismiss());
  const snap=()=>p.evaluate(()=>{const x=rbCollectProject();delete x.meta.created;return x;});
  const ready=async()=>{await p.goto(pathToFileURL(path.join(root,'index.html')).href);await p.waitForFunction(()=>!!web4core&&!!jsyaml);};
  const reveal=async selector=>p.locator(selector).evaluate(el=>{for(let n=el.parentElement;n;n=n.parentElement)if(n.tagName==='DETAILS')n.open=true;});
  const build=async()=>{await p.locator('button[onclick="buildMihomo()"]').click();await p.waitForFunction(()=>['VALID','INVALID'].includes(MIHOMO_VALIDATION_STATE.state));assert.equal(await p.evaluate(()=>MIHOMO_VALIDATION_STATE.state),'VALID');return p.locator('#mihomoOutput').inputValue();};
  const studio=async text=>{await p.locator('.tab',{hasText:'Config Studio'}).click();await p.fill('#csImportInput',text);await p.click('#csParseBtn');assert.match(await p.locator('#csStatus').textContent(),/Разобрано/);};
  const layout=async section=>{
   for(const width of widths){
    await p.setViewportSize({width,height:900});
    const d=await p.evaluate(()=>({width:innerWidth,scrollX,body:document.body.getBoundingClientRect().toJSON(),wide:[...document.querySelectorAll('body *')].filter(e=>e.namespaceURI==='http://www.w3.org/1999/xhtml'&&e.clientWidth&&e.scrollWidth>e.clientWidth+2).map(e=>({id:e.id,tag:e.tagName,client:e.clientWidth,scroll:e.scrollWidth,overflow:getComputedStyle(e).overflow})).slice(0,30),scroll:document.documentElement.scrollWidth,offenders:[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return e.namespaceURI==='http://www.w3.org/1999/xhtml'&&r.width&&r.right>innerWidth+2;}).map(e=>({id:e.id,tag:e.tagName,classes:typeof e.className==='string'?e.className:'',right:Math.round(e.getBoundingClientRect().right),width:Math.round(e.getBoundingClientRect().width)})).slice(0,30),small:[...document.querySelectorAll('button,summary')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height&&getComputedStyle(e).visibility!=='hidden'&&(r.width<24||r.height<24);}).map(e=>e.id||e.className||e.tagName)}));
    if(d.scroll>d.width+1)fs.writeFileSync(path.join(process.env.TEST_OUTPUT_DIR||path.join(lab.dir,'results'),'overflow.json'),JSON.stringify({section,width,...d},null,2));assert.ok(d.scroll<=d.width+1,section+' document overflow at '+width+' ('+d.scroll+')');
    assert.equal(d.small.length,0,section+': small button/summary targets at '+width);result.layouts.push({section,width,overflow:false,smallTargets:d.small});
   }
  };
  await ready();
  await p.fill('#mihomoInput',Array.from({length:6},(_,i)=>'https://sub'+i+'.example.invalid/feed').join('\n'));
  await p.locator('#wgFile').setInputFiles(lab.profiles.map((file,i)=>({name:i===0?'日本_Профиль_'+ 'long'.repeat(30)+'.conf':path.basename(file),mimeType:'text/plain',buffer:fs.readFileSync(file)})));
  await p.waitForFunction(()=>wgProfiles.length===8);
  await reveal('#cfgTun');await p.check('#cfgTun');await p.check('#cfgTunMips');await p.check('#cfgWebUI');
  await reveal('#cfgPolicyRouting');await p.check('#cfgPolicyRouting');await p.click('#btnPolicyAdd');
  const original=await build(),before=await snap();
  await layout('Builder/WG');
  const [download]=await Promise.all([p.waitForEvent('download'),p.locator('button[onclick="rbSaveProject()"]').click()]);
  const projectFile=path.join(lab.dir,'generated','final-ui.lgproject.json');await download.saveAs(projectFile);
  await ready();const empty=await snap();
  await p.locator('#rbProjectFile').setInputFiles(projectFile);await p.waitForFunction(()=>document.getElementById('toast').textContent.includes('отменена'));
  same(await snap(),empty,'Load Cancel changed Builder');accept=true;
  await p.locator('#rbProjectFile').setInputFiles([]);await p.locator('#rbProjectFile').setInputFiles(projectFile);
  await p.waitForFunction(()=>document.getElementById('toast').textContent.includes('Проект загружен'));same(await snap(),before,'Project drift');
  same(normalized(await build()),normalized(original),'Project YAML drift');
  await p.locator('.wg-list-del').last().click();
  await p.fill('#mihomoInput',Array.from({length:8},(_,i)=>'https://sub'+i+'.example.invalid/feed').join('\n'));
  const modified=await build(),modifiedProject=await snap();assert.equal(modifiedProject.wgProfiles.length,7);
  same(modifiedProject.wgProfiles.map(w=>w.bean),before.wgProfiles.slice(0,7).map(w=>w.bean),'WG beans changed');
  same(modifiedProject.options,before.options,'Unrelated options changed');same(modifiedProject.domainPolicy,before.domainPolicy,'DPR changed');
  const target=yaml.load(modified).proxies.find(n=>n.type==='wireguard').name;
  await p.locator('.wg-mode').nth(1).selectOption('proxy');
  const wid=await p.evaluate(()=>wgProfiles[1].id);await p.locator('#wgTarget'+wid).selectOption('__manual__');await p.locator('.wg-target-manual').nth(1).fill(target);
  await p.locator('.wg-target-manual').nth(1).press('Tab');const finalYaml=await build(),finalProject=await snap();
  await layout('WG dialer edited');await studio(finalYaml);same(await snap(),finalProject,'Studio/DNS modified Builder');
  const hasDns=await p.locator('#csDnsRoutingOut').count();result.dnsCandidate=!!hasDns;
  if(hasDns){assert.match(await p.locator('#csDnsRoutingOut').textContent(),/неактивна/);same(await p.locator('#csImportInput').inputValue(),finalYaml,'DNS changed source');}
  for(const id of ['csGraphPanel','csTracePanel','csVrgPanel','csDnsRoutingPanel'])if(await p.locator('#'+id).count())await p.locator('#'+id).evaluate(el=>el.open=true);
  await layout('Studio/VRG/DNS');
  await p.click('#csRestoreBtn');same(await snap(),finalProject,'Reverse Preview mutated Builder');await layout('Reverse Preview');
  await p.click('#rbCancelRestoreBtn');same(await snap(),finalProject,'Reverse Cancel drift');
  await p.click('#csRestoreBtn');await p.check('#rbLossAck');await p.click('#rbConfirmRestoreBtn');
  const reversed=await build();fs.writeFileSync(path.join(lab.dir,'generated','before-reverse.yaml'),finalYaml);fs.writeFileSync(path.join(lab.dir,'generated','after-reverse.yaml'),reversed);same(normalized(reversed),normalized(finalYaml),'Supported Reverse YAML drift');
  await p.click('#rbUndoBtn');same(await snap(),finalProject,'Undo drift');
  await studio(reversed);if(hasDns)assert.match(await p.locator('#csDnsRoutingOut').textContent(),/неактивна/);
  await p.selectOption('#csEditType','proxy');await reveal('#csSaveFieldsBtn');await layout('YAML Editor');
  await p.locator('#csSaveFieldsBtn').focus();assert.equal(await p.locator('#csSaveFieldsBtn').evaluate(el=>el===document.activeElement),true);
  await p.locator('#csGraphPanel > summary').focus();await p.keyboard.press('Tab');await p.keyboard.press('Shift+Tab');const wasOpen=await p.locator('#csGraphPanel').evaluate(el=>el.open);await p.keyboard.press('Enter');assert.equal(await p.locator('#csGraphPanel').evaluate(el=>el.open),!wasOpen);
  await p.keyboard.press('Space');assert.equal(await p.locator('#csGraphPanel').evaluate(el=>el.open),wasOpen);
  const focus=await p.locator('#csGraphPanel > summary').evaluate(el=>({active:el===document.activeElement,outline:getComputedStyle(el).outlineStyle}));assert.equal(focus.active,true);assert.notEqual(focus.outline,'none');result.keyboard=true;
  for(const enable of [undefined,false,true]){const d={dns:{nameserver:['192.0.2.53'],...(enable===undefined?{}:{enable})},rules:['MATCH,DIRECT']};await studio(yaml.dump(d));assert.equal(await p.evaluate(()=>csSummarize(csCurrentDoc).dns),enable===true,'DNS summary must follow actual enable/default');if(hasDns)assert.equal((await p.locator('#csDnsRoutingOut').textContent()).includes('неактивна'),enable!==true);}
  await p.locator('.tab',{hasText:'Mihomo Config Builder'}).click();await reveal('#ptDemoBtn');await p.click('#ptDemoBtn');await p.click('#ptAnalyzeBtn');await layout('Physical Topology');
  assert.equal(errors.length,0,'Browser errors');
  for(const w of before.wgProfiles){const key=w.bean.wireguard.privateKey;assert.ok(!logs.some(x=>x.includes(key)),'Console leaked key');}
  assert.equal(result.externalRequests,0);result.journey=true;result.status='PASS';
  const dest=process.env.TEST_OUTPUT_DIR||path.join(lab.dir,'results');fs.mkdirSync(dest,{recursive:true});fs.writeFileSync(path.join(dest,'final-release-browser.json'),JSON.stringify(result,null,2));
  console.log('PASS final-release-browser: '+engine+'; journey6+8→8+7; '+result.layouts.length+' layout checks; DNS candidate '+!!hasDns);
 }finally{await browser.close();if(ephemeral){assert.equal(path.dirname(lab.dir),path.resolve(os.tmpdir()));fs.rmSync(lab.dir,{recursive:true,force:true});}}
})().catch(e=>{console.error(e);process.exitCode=1;});
