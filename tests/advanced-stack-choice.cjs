const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const pw=require('playwright');
const root=process.env.TEST_ROOT||path.resolve(__dirname,'..');
(async()=>{
 for(const engine of (process.env.TEST_ENGINES||'chromium,firefox,webkit').split(',')){
  const browser=await pw[engine].launch({headless:true});
  try{
   const page=await browser.newPage();
   await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({path:process.env.JS_YAML_PATH,contentType:'text/javascript'}));
   await page.goto(pathToFileURL(path.join(root,'index.html')).href);
   await page.waitForFunction(()=>!!globalThis.web4core&&!!globalThis.jsyaml);
   const build=async()=>{await page.locator('button[onclick="buildMihomo()"]').click();await page.waitForFunction(()=>MIHOMO_VALIDATION_STATE.state==='VALID');return page.locator('#mihomoOutput').inputValue();};
   await page.locator('#cfgSubMode').uncheck();await page.locator('#mihomoInput').fill('vless://00000000-0000-4000-8000-000000000001@192.0.2.1:443#A');
   for(const profile of ['router','vps-local','vps-gateway','router']){
    await page.selectOption('#cfgProfile',profile);
    await page.locator('#cfgSubMode').uncheck();
    const before=await build();const fp=await page.evaluate(()=>buildStateFingerprint());
    const summary=page.locator('#perProxyAdvancedSummary'),details=page.locator('#perProxyAdvancedDetails');
    await summary.evaluate(e=>{for(let p=e.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;});
    for(const key of ['click','Enter','Space']){
     for(let i=0;i<2;i++){
      const open=await details.evaluate(e=>e.open);
      if(key==='click')await summary.click();else{await summary.focus();await summary.press(key);}
      assert.equal(await details.evaluate(e=>e.open),!open,profile+' disclosure '+key);
     }
    }
    assert.equal(await page.evaluate(()=>buildStateFingerprint()),fp,'disclosure no fingerprint change');
    assert.equal(await build(),before,'disclosure no YAML change');
    if(profile==='vps-local'){
     for(const id of ['cfgTun','cfgTunMips','cfgTunStackAdvanced','cfgPerProxyMaster'])assert.equal(await page.locator('#'+id).isDisabled(),true,id+' intentionally disabled');
     await page.evaluate(()=>{cfgTun.checked=true;cfgTunMips.checked=true;});
     assert.ok(!/^tun:/m.test(await build()),'DOM tamper cannot enable TUN in SOCKS-only profile');
    }
   }
   await page.selectOption('#cfgProfile','vps-local');await page.selectOption('#cfgProfile','vps-gateway');
   await page.locator('#cfgSubMode').uncheck();
   await page.locator('#cfgTunStackAdvanced').evaluate(e=>{for(let p=e.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;});
   const before=await build();await page.locator('#cfgTunStackAdvanced').check();
   const select=page.locator('#cfgTunStackEx');
   assert.equal(await select.inputValue(),'','no silent assignment of stack');
   assert.match(await select.evaluate(e=>e.selectedOptions[0]?.textContent||''),/Выберите/,'empty advanced select must explain choice');
   assert.equal(await build(),before,'unselected advanced stack preserves fallback YAML');
   for(const stack of ['system','mixed']){
    await select.selectOption(stack);const yaml=await build();assert.match(yaml,new RegExp('stack: '+stack));
    const p=await page.evaluate(()=>rbCollectProject());await page.evaluate(p=>rbApplyProject(p),p);assert.equal(await build(),yaml,'project preserves stack');
   }
   for(const width of [320,390,768,1366]){await page.setViewportSize({width,height:720});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
   console.log(engine+': disclosure/guards/explicit stack/project/YAML PASS');
  }finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
