// #273 security regression: successful Reset consumes recipient consent and
// custom endpoint memory; Cancel/admission failure preserve the current state.
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const pw=require('playwright');
const root=process.env.TEST_ROOT||path.resolve(__dirname,'..');
const endpoint='http://reset-fixture.example:9090';
(async()=>{
 for(const engine of (process.env.TEST_ENGINES||'chromium,firefox,webkit').split(',')){
  const browser=await pw[engine].launch({headless:true});
  try{
   const page=await browser.newPage();let dialogs=0,accept=true,unexpected=[],consoleText=[];
   page.on('dialog',d=>{dialogs++;assert.ok(!/synthetic-(before|after)/.test(d.message()),'dialog must not print secret');return accept?d.accept():d.dismiss();});
   page.on('console',m=>consoleText.push(m.text()));
   await page.route('**/*',r=>{
    const u=r.request().url();if(u.startsWith('file:'))return r.continue();
    if(u.startsWith('https://cdn.jsdelivr.net/'))return r.fulfill({path:process.env.JS_YAML_PATH,contentType:'text/javascript'});
    unexpected.push(u);return r.abort();
   });
   await page.goto(pathToFileURL(path.join(root,'index.html')).href);
   await page.waitForFunction(()=>!!globalThis.web4core&&!!globalThis.jsyaml);
   // Fetch fixture with an abort-ignoring late response verifies both actual
   // AbortSignal cancellation and sequence rejection without contacting a host.
   await page.evaluate(()=>{
    window.resetProbe={requests:0,held:false,signal:null,complete:null};
    const originalFetch=window.fetch;
    window.fetch=(url,opts)=>{
     if(!String(url).startsWith('http://reset-fixture.example:9090/'))return originalFetch(url,opts);
     if(String(url)!=='http://reset-fixture.example:9090/providers/proxies')throw Error('Unexpected fixture path');
     if(opts.method && opts.method!=='GET')throw Error('Unexpected fixture write');
     resetProbe.requests++;resetProbe.signal=opts.signal;
     const result=()=>new Response(JSON.stringify({providers:{Fixture:{proxies:[{name:'Synthetic',type:'Trojan',password:'synthetic-response-private'}]}}}),{status:200,headers:{'Content-Type':'application/json'}});
     return resetProbe.held?new Promise(resolve=>{resetProbe.complete=()=>resolve(result());}):Promise.resolve(result());
    };
   });
   const open=async()=>{await page.locator('#cfgServerList').check();await page.locator('#runtimeImportDetails').evaluate(e=>e.open=true);};
   const clickFetch=async()=>{await page.locator('#rtFetchBtn').click();await page.waitForFunction(()=>document.getElementById('rtStatus').textContent!=='Загрузка…');};
   const reset=async action=>{await page.locator('#builderResetBtn').click();await page.locator('#builderReset'+action).click();};
   const snapshot=()=>page.evaluate(()=>({address:rtControllerInput.value,secret:rtSecretInput.value,preset:rtControllerPreset.value,approved:rtSecretApprovedEndpoint,project:rbProjectFingerprint(rbCollectProject()),yaml:mihomoOutput.value,seq:rtImportSeq}));
   await page.locator('#cfgSubMode').uncheck();await page.locator('#mihomoInput').fill('vless://00000000-0000-4000-8000-000000000001@192.0.2.1:443#Synthetic');
   await open();await page.locator('#rtControllerInput').fill(endpoint);await page.locator('#rtSecretInput').fill('synthetic-before-reset');
   await clickFetch();assert.equal(dialogs,1);assert.equal(await page.evaluate(()=>resetProbe.requests),1);
   const before=await snapshot();await reset('Cancel');assert.deepEqual(await snapshot(),before,'Cancel preserves state and consent');
   // Admission failure must not clear hidden state or abort accepted work.
   await page.evaluate(()=>{window.probeApply=rbApplyProject;rbApplyProject=()=>{throw Error('synthetic admission failure');};});
   await reset('Confirm');assert.equal(await page.locator('#builderResetDialog').evaluate(e=>e.open),true);
   assert.deepEqual(await snapshot(),before,'failed Reset preserves state and consent');
   await page.locator('#builderResetCancel').click();await page.evaluate(()=>{rbApplyProject=probeApply;});
   await page.locator('#rtControllerPreset').selectOption('127.0.0.1:9090');await page.locator('#rtControllerPreset').selectOption('custom');
   assert.equal(await page.locator('#rtControllerInput').inputValue(),endpoint,'Cancel/error retain custom draft');
   await reset('Confirm');
   assert.equal(await page.locator('#rtControllerInput').inputValue(),'');assert.equal(await page.locator('#rtSecretInput').inputValue(),'');
   assert.equal(await page.evaluate(()=>rtSecretApprovedEndpoint),null,'successful Reset clears recipient approval');
   await open();await page.locator('#rtControllerPreset').selectOption('custom');
   assert.equal(await page.locator('#rtControllerInput').inputValue(),'','old custom address must not reappear');
   await page.locator('#rtControllerInput').fill(endpoint);await page.locator('#rtSecretInput').fill('synthetic-after-reset');
   accept=false;await clickFetch();assert.equal(dialogs,2,'fresh consent mandatory after Reset');assert.equal(await page.evaluate(()=>resetProbe.requests),1,'refusal sends nothing');
   accept=true;await clickFetch();assert.equal(dialogs,3);assert.equal(await page.evaluate(()=>resetProbe.requests),2);
   await page.evaluate(()=>resetProbe.held=true);await page.locator('#rtFetchBtn').click();
   await page.waitForFunction(()=>document.getElementById('rtStatus').textContent==='Загрузка…');
   await reset('Cancel');assert.equal(await page.evaluate(()=>resetProbe.signal.aborted),false,'Cancel does not abort current request');
   await page.evaluate(()=>{window.probeApply=rbApplyProject;rbApplyProject=()=>{throw Error('synthetic admission failure');};});
   await reset('Confirm');assert.equal(await page.evaluate(()=>resetProbe.signal.aborted),false,'admission failure does not abort current request');
   await page.locator('#builderResetCancel').click();await page.evaluate(()=>{rbApplyProject=probeApply;});
   await reset('Confirm');assert.equal(await page.evaluate(()=>resetProbe.signal.aborted),true,'successful Reset aborts request');
   assert.equal(await page.evaluate(()=>rtImportAbort),null);
   await page.evaluate(()=>resetProbe.complete());await page.evaluate(()=>new Promise(r=>setTimeout(r,30)));
   assert.equal(await page.evaluate(()=>runtimeProviderModel.providers.length),0,'late response cannot resurrect runtime list');
   assert.equal(await page.evaluate(()=>rtSecretApprovedEndpoint),null);
   await open();await page.locator('#rtControllerPreset').selectOption('custom');assert.equal(await page.locator('#rtControllerInput').inputValue(),'');
   const surfaces=await page.evaluate(()=>document.body.innerText+JSON.stringify({...localStorage})+JSON.stringify(rbCollectProject()));
   for(const secret of ['synthetic-before-reset','synthetic-after-reset','synthetic-response-private']){
    assert.ok(!surfaces.includes(secret),'secret absent from diagnostics/project/storage');assert.ok(!consoleText.some(s=>s.includes(secret)),'secret absent from console');
   }
   assert.deepEqual(unexpected,[],'no controller/worker/extra network');
   console.log(engine+': Reset clears custom/consent; fresh recipient consent, Cancel/error/abort/late response/privacy PASS');
  }finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
