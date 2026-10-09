// Synthetic real Build -> Reverse -> Build parity, with non-default gateway fields.
const assert=require('node:assert/strict'),path=require('node:path');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
 try{
  const page=await browser.newPage();
  await page.route('https://**',r=>r.request().url().startsWith('https://cdn.jsdelivr.net/')?r.fulfill({path:process.env.JS_YAML_PATH,contentType:'text/javascript'}):r.abort());
  await page.goto(pathToFileURL(path.join(__dirname,'..','index.html')).href);
  await page.waitForFunction(()=>!!web4core&&!!jsyaml);
  for(const dnsOn of [false,true]){
   await page.evaluate(dnsOn=>{
    const p=rbCollectProject();p.sources.mainInput='https://sub.example.invalid/feed';p.sources.subMode=true;
    Object.assign(p.options,{profile:'vps-gateway',addTun:true,addSocks:true,webUI:true,webUiDashboard:'yacd',urlTestPreset:'__custom__',urlTestCustomUrl:'https://health.example.invalid/check',vpsDnsEnabled:dnsOn,vpsDevice:'tun-synthetic',vpsMtu:'1340',vpsFakeIp:'198.19.0.0/16',vpsDnsListen:'127.0.0.1:1053',vpsDnsNs:'192.0.2.53, 192.0.2.54',vpsProxyNs:'192.0.2.55'});
    rbApplyProject(p);
   },dnsOn);
   await page.evaluate(()=>buildMihomo());
   await page.waitForFunction(()=>['VALID','INVALID'].includes(MIHOMO_VALIDATION_STATE.state));
   const original=await page.evaluate(()=>document.getElementById('mihomoOutput').value);
   const restored=await page.evaluate(()=>rbYamlToProject(jsyaml.load(document.getElementById('mihomoOutput').value)).project);
   assert.equal(restored.options.profile,'vps-gateway','gateway DNS-off must not turn into router');
   assert.equal(restored.options.vpsDevice,'tun-synthetic');assert.equal(restored.options.vpsMtu,'1340');
   assert.equal(restored.options.vpsDnsEnabled,dnsOn);
   assert.equal(restored.options.urlTestPreset,'__custom__');
   assert.equal(restored.options.urlTestCustomUrl,'https://health.example.invalid/check');
   assert.ok(restored.passthrough['source-config']);
   await page.evaluate(p=>rbApplyProject(p),restored);
   await page.evaluate(()=>buildMihomo());
   await page.waitForFunction(()=>['VALID','INVALID'].includes(MIHOMO_VALIDATION_STATE.state));
   assert.equal(await page.evaluate(()=>document.getElementById('mihomoOutput').value),original,'gateway reverse byte parity DNS '+dnsOn);
  }
  const off=await page.evaluate(()=>rbYamlToProject({tun:{enable:false,device:'disabled-device'},rules:['MATCH,DIRECT']}).project.options.addTun);
  assert.equal(off,false,'explicitly disabled TUN remains off');
  console.log('PASS independent-reverse-profiles-browser: 3 groups');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
