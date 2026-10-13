const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const pw=require('playwright');
const root=process.env.TEST_ROOT||path.resolve(__dirname,'..');
const link='vless://00000000-0000-4000-8000-000000000001@192.0.2.1:443#Static';
(async()=>{
 for(const engine of (process.env.TEST_ENGINES||'chromium,firefox,webkit').split(',')){
  const browser=await pw[engine].launch({headless:true});
  try{
   const page=await browser.newPage(); let requests=[];
   await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({path:process.env.JS_YAML_PATH,contentType:'text/javascript'}));
   await page.route('https://subscription.example/**',r=>{requests.push(r.request().url());return r.fulfill({body:link,contentType:'text/plain'});});
   await page.goto(pathToFileURL(path.join(root,'index.html')).href);
   await page.waitForFunction(()=>!!globalThis.web4core&&!!globalThis.jsyaml);
   const build=async()=>{await page.locator('button[onclick="buildMihomo()"]').click();await page.waitForFunction(()=>MIHOMO_VALIDATION_STATE.state==='VALID');return page.locator('#mihomoOutput').inputValue();};
   await page.locator('#cfgSubMode').uncheck();await page.locator('#mihomoInput').fill(link);
   const before=await build();
   const hint=page.locator('#subModeInputHint');
   assert.equal(await hint.count(),1,'input-local subscription explanation exists');
   assert.match(await hint.innerText(),/WG\/AWG.*файл/);
   await page.locator('#subModeJump').click();
   assert.equal(await page.evaluate(()=>document.activeElement.id),'cfgSubMode');
   assert.equal(await page.locator('#cfgSubMode').isChecked(),false,'navigation does not toggle');
   assert.equal(await page.evaluate(()=>buildStateFingerprint()===lastBuildFingerprint),true);
   assert.equal(await build(),before,'plain YAML byte parity after navigation');
   assert.equal(requests.length,0,'no requests for help/navigation/plain links');
   await page.locator('#cfgSubMode').check();
   await page.locator('#wgFile').setInputFiles(path.join(root,'tests','fixtures','awg31.conf'));
   await page.waitForFunction(()=>wgUploadPending===false&&wgBeans.length===1);
   await page.locator('#mihomoInput').fill(link+'\nhttps://subscription.example/list');
   const mixed=await build();
   assert.match(mixed,/proxy-providers:/);assert.match(mixed,/192\.0\.2\.1/);assert.match(mixed,/type: wireguard/);
   assert.equal(requests.length,0,'ON keeps URL in YAML without browser fetch');
   const project=await page.evaluate(()=>rbCollectProject());
   await page.evaluate(p=>rbApplyProject(p),project);
   assert.equal(await build(),mixed,'project roundtrip byte parity');
   await page.locator('#cfgSubMode').uncheck();
   const expanded=await build();assert.ok(!expanded.includes('https://subscription.example/list'));
   assert.equal(requests.length,1,'OFF fetches once only at explicit Build');
   for(const width of [320,390,768,1366]){
    await page.setViewportSize({width,height:720});await page.locator('#subModeJump').scrollIntoViewIfNeeded();
    await page.locator('#subModeJump').focus();await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'cfgSubMode');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
   }
   console.log(engine+': Sub Mode help/mixed/project/no-extra-network PASS');
  }finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
