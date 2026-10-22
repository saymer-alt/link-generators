'use strict';
// #280 per-subscription project identity UI; no real endpoints or secrets.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const U=['https://a.example.invalid/feed','https://b.example.invalid/feed','https://c.example.invalid/feed'];
const H3='33333333333333333333333333333333';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'lg-per-provider-ui-'));
let count=0;
async function main(){
  const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
  const aCtx=await browser.newContext({acceptDownloads:true});
  const bCtx=await browser.newContext({acceptDownloads:true});
  const a=await aCtx.newPage(),b=await bCtx.newPage();
  const errors=[];let requestCount=0;
  async function init(p){
    p.on('pageerror',e=>errors.push(e.message));
    p.on('dialog',d=>d.accept());
    p.on('request',r=>{if(U.some(x=>r.url().startsWith(x)))requestCount++;});
    if(process.env.JS_YAML_PATH)await p.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({path:process.env.JS_YAML_PATH,contentType:'text/javascript'}));
    await p.goto(pathToFileURL(path.join(root,'index.html')).href);
    await p.waitForFunction(()=>!!globalThis.web4core&&!!globalThis.jsyaml);
  }
  await init(a);await init(b);
  const localA=await a.evaluate(()=>getActiveDeviceIdentity().hwid);
  const localB=await b.evaluate(()=>getActiveDeviceIdentity().hwid);
  assert.notEqual(localA,localB);
  const registryB=await b.evaluate(()=>localStorage.getItem(DEVICE_IDENTITY_STORAGE_KEY));
  await a.locator('#mihomoInput').fill(U.join('\n'));
  await a.locator('#cfgSubMode').check();
  await a.locator('#deviceIdentityDetails summary').click();
  assert.equal(await a.locator('#rbPortablePanel').isVisible(),false);
  await a.locator('#rbPortableActivateBtn').click();
  assert.equal(await a.locator('#rbPortablePanel').isVisible(),true);
  assert.equal(await a.locator('#rbPortableSources select').count(),3);
  const original=await a.evaluate(()=>{
    const x=rbPortableEngineOptions(rbCollectProject());
    return {ok:x.ok,one:new Set(x.options.providerOverrides.map(z=>z.hwid)).size===1};
  });
  assert.deepEqual(original,{ok:true,one:true});count++;

  // Assign an explicitly new HWID to B using just the UI, then share with C.
  await a.locator('#rbPortableNewSource').selectOption({index:1});
  await a.locator('#rbPortableNewLabel').fill('Provider B');
  await a.locator('#rbPortableRandomBtn').click();
  const secondId=await a.locator('#rbPortableSources select').nth(1).inputValue();
  assert.notEqual(secondId,await a.locator('#rbPortableSources select').first().inputValue());
  await a.locator('#rbPortableSources select').nth(2).selectOption(secondId);
  const mapping=await a.evaluate(()=>{
    const p=rbCollectProject();
    const m=rbPortableEngineOptions(p);
    const ids=m.options.providerOverrides.map(x=>x.hwid);
    return {n:p.identities.entries.length,defaultSame:ids[0]===m.options.deviceHwid,
      differs:ids[0]!==ids[1],shared:ids[1]===ids[2]};
  });
  assert.deepEqual(mapping,{n:2,defaultSame:true,differs:true,shared:true});
  count++;

  // Duplicate/new URLs must never silently remap; exact reorder is explicit.
  await a.locator('#mihomoInput').fill([U[2],U[0],U[1]].join('\n'));
  assert.match(await a.locator('#rbPortableMappingStatus').textContent(),/Изменились URL/);
  assert.equal(await a.locator('#rbPortableSources select').first().isDisabled(),true);
  await a.locator('#rbPortableReorderBtn').click();
  assert.match(await a.locator('#rbPortableMappingStatus').textContent(),/согласованы/);
  const reordered=await a.evaluate(()=>{
    const p=rbCollectProject(),m=rbPortableEngineOptions(p),z=m.options.providerOverrides.map(x=>x.hwid);
    return {ok:m.ok,shared:z[0]===z[2],differs:z[0]!==z[1],sourceIDs:p.sources.subscriptionSources.map(x=>x.sourceId)};
  });
  assert.equal(reordered.ok,true);
  assert.equal(reordered.shared,true);assert.equal(reordered.differs,true);
  assert.deepEqual(reordered.sourceIDs,['src-3','src-1','src-2']);
  count++;

  // Invalid manual value must not modify the project, and its input is cleared.
  const pBefore=await a.evaluate(()=>JSON.stringify(rbCollectProject().identities));
  await a.locator('#rbPortableNewSource').selectOption({index:2});
  await a.locator('#rbPortableNewLabel').fill('Manual');
  await a.locator('#rbPortableNewHwid').fill('wrong/secret');
  await a.locator('#rbPortableImportHwidBtn').click();
  assert.equal(await a.locator('#rbPortableNewHwid').inputValue(),'');
  assert.equal(await a.evaluate(()=>JSON.stringify(rbCollectProject().identities)),pBefore);
  await a.locator('#rbPortableNewHwid').fill(H3);
  await a.locator('#rbPortableImportHwidBtn').click();
  const identities=await a.evaluate(()=>{
    const p=rbCollectProject(),m=rbPortableEngineOptions(p),ids=m.options.providerOverrides.map(x=>x.hwid);
    return {n:p.identities.entries.length,manualB:ids[2]==='33333333333333333333333333333333',oldC:ids[0]!==ids[2]};
  });
  assert.deepEqual(identities,{n:3,manualB:true,oldC:true});count++;

  // UI, status, and diff never expose HWIDs or raw subscription URL.
  const visible=await a.evaluate(()=>document.getElementById('rbPortablePanel').textContent+
    document.getElementById('rbPortableModeNotice').textContent+document.getElementById('toast').textContent);
  for (const secret of [localA,H3,...U]) assert.ok(!visible.includes(secret),'no raw HWID/URL in UI');
  const [d]=await Promise.all([a.waitForEvent('download'),a.locator('button[onclick="rbSaveProject()"]').click()]);
  const saved=path.join(tmp,'ui-project.lgproject.json');await d.saveAs(saved);
  const p=JSON.parse(fs.readFileSync(saved,'utf8'));
  assert.equal(p.schemaVersion,2);
  assert.equal(p.identities.entries.length,3);
  count++;

  await b.locator('#rbProjectFile').setInputFiles(saved);
  await b.waitForFunction(()=>rbCollectProject().schemaVersion===2);
  assert.equal(await b.evaluate(()=>localStorage.getItem(DEVICE_IDENTITY_STORAGE_KEY)),registryB);
  assert.equal(await b.evaluate(()=>getActiveDeviceIdentity().hwid),localB);
  await b.locator('#deviceIdentityDetails summary').click();
  assert.equal(await b.locator('#rbPortableSources select').count(),3);
  const roundtrip=await b.evaluate(()=>{
    const p=rbCollectProject(),m=rbPortableEngineOptions(p),ids=m.options.providerOverrides.map(x=>x.hwid);
    return {ok:m.ok,three:p.identities.entries.length===3,sharedOriginal:false,
      actualOrder:ids[0]!==ids[1] && ids[1]!==ids[2] && ids[0]!==ids[2]};
  });
  assert.equal(roundtrip.ok,true);
  assert.equal(roundtrip.three,true);
  assert.equal(roundtrip.actualOrder,true);
  count++;

  await b.locator('#rbUndoBtn').click();
  assert.equal((await b.evaluate(()=>rbCollectProject())).schemaVersion,1);
  assert.equal(await b.evaluate(()=>localStorage.getItem(DEVICE_IDENTITY_STORAGE_KEY)),registryB);
  assert.equal(requestCount,0);
  assert.deepEqual(errors,[],'no JS errors: '+errors.join('|'));
  count++;
  await browser.close();
  console.log('PASS portable-identity-ui-browser: '+count+' UI/roundtrip/reorder/secret checks');
}
main().catch(e=>{console.error(e);process.exitCode=1});
