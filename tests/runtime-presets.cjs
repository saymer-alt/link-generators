const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const pw=require('playwright');
const root=process.env.TEST_ROOT||path.resolve(__dirname,'..');
(async()=>{
 for(const engine of (process.env.TEST_ENGINES||'chromium,firefox,webkit').split(',')){
  const browser=await pw[engine].launch({headless:true});
  try{
   const page=await browser.newPage();let requests=[],response=200,accept=true,dialogs=0;
   page.on('dialog',d=>{dialogs++;assert.ok(!d.message().includes('synthetic-api-secret'));return accept?d.accept():d.dismiss();});
   await page.route('**/*',r=>{
    const u=r.request().url();
    if(u.startsWith('file:'))return r.continue();
    if(u.startsWith('https://cdn.jsdelivr.net/'))return r.fulfill({path:process.env.JS_YAML_PATH,contentType:'text/javascript'});
    requests.push({url:u,method:r.request().method(),auth:r.request().headers().authorization});
    if(response===0)return r.abort();
    return r.fulfill({status:response,contentType:'application/json',body:JSON.stringify({providers:{Test:{proxies:[{name:'Synthetic node',type:'Trojan',alive:true}]}}})});
   });
   await page.goto(pathToFileURL(path.join(root,'index.html')).href);
   await page.waitForFunction(()=>!!globalThis.web4core&&!!globalThis.jsyaml);
   await page.locator('#cfgSubMode').uncheck();await page.locator('#mihomoInput').fill('vless://00000000-0000-4000-8000-000000000001@192.0.2.1:443#A');
   const build=async()=>{await page.locator('button[onclick="buildMihomo()"]').click();await page.waitForFunction(()=>MIHOMO_VALIDATION_STATE.state==='VALID');return page.locator('#mihomoOutput').inputValue();};
   const yaml=await build();const fp=await page.evaluate(()=>buildStateFingerprint());
   await page.locator('#cfgServerList').check();
   await page.locator('#runtimeImportDetails').evaluate(e=>e.open=true);
   const inputFp=await page.evaluate(()=>buildStateFingerprint());
   const select=page.locator('#rtControllerPreset'),input=page.locator('#rtControllerInput');
   assert.equal(await select.count(),1,'runtime presets exist');
   const click=async()=>{await page.locator('#rtFetchBtn').click();await page.waitForFunction(()=>document.getElementById('rtStatus').textContent!=='Загрузка…');};
   for(const endpoint of ['192.168.1.1:9090','192.168.0.1:9090','127.0.0.1:9090']){
    const count=requests.length;await select.selectOption(endpoint);assert.equal(await input.inputValue(),endpoint);
    await page.waitForTimeout(50);assert.equal(requests.length,count,'selection no fetch');
    if(count===0)assert.equal(await page.evaluate(()=>buildStateFingerprint()),inputFp,'preset selection excluded from fingerprint');
    await click();
    assert.equal(requests.at(-1).url,'http://'+endpoint+'/providers/proxies');assert.equal(requests.at(-1).method,'GET');
   }
   await select.selectOption('custom');await input.fill('https://custom.example:9443/prefix');
   await select.selectOption('127.0.0.1:9090');await select.selectOption('custom');
   assert.equal(await input.inputValue(),'https://custom.example:9443/prefix','custom draft retained');
   await page.locator('#rtSecretInput').fill('synthetic-api-secret');accept=false;
   let n=requests.length;await click();assert.equal(requests.length,n,'refused consent no request');
   accept=true;await click();assert.equal(requests.at(-1).url,'https://custom.example:9443/prefix/providers/proxies');assert.equal(requests.at(-1).auth,'Bearer synthetic-api-secret');
   await select.selectOption('192.168.0.1:9090');accept=false;n=requests.length;await click();assert.equal(requests.length,n,'new host requires fresh consent');
   await input.fill('');await click();assert.equal(requests.length,n,'empty endpoint confirmation retained');
   await input.fill('ftp://invalid.example');await click();assert.equal(requests.length,n,'invalid URI no request');
   await input.fill('https://custom.example:9443/prefix');accept=true;
   for(const status of [401,403,404]){response=status;await click();assert.match(await page.locator('#rtStatus').innerText(),new RegExp('HTTP '+status));}
   response=0;await click();assert.match(await page.locator('#rtStatus').innerText(),/причина не установлена/);
   assert.ok(requests.every(r=>r.url.endsWith('/providers/proxies')&&r.method==='GET'),'no worker/scanning/writes');
   assert.ok(!await page.locator('#rtStatus').innerText().then(s=>s.includes('synthetic-api-secret')));
   const saved=await page.evaluate(()=>JSON.stringify(rbCollectProject())+JSON.stringify({...localStorage}));
   for(const forbidden of ['synthetic-api-secret','custom.example','rtController'])assert.ok(!saved.includes(forbidden),'no endpoint/secret persistence');
   await page.locator('#cfgServerList').uncheck();
   await page.evaluate(()=>clearRuntimeList());
   assert.equal(await page.evaluate(()=>buildStateFingerprint()),fp,'runtime UI excluded from fingerprint');
   assert.equal(await page.locator('#mihomoOutput').inputValue(),yaml,'runtime actions leave YAML untouched');
   assert.equal(await build(),yaml,'generated YAML byte parity');
   assert.ok(dialogs>=4);
   for(const width of [320,390,768,1366]){await page.setViewportSize({width,height:720});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no overflow');}
   console.log(engine+': presets/custom/consent/HTTP/errors/privacy/YAML PASS');
  }finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
