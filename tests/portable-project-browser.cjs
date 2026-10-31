'use strict';
// #280 v2 browser project scope: explicit export/import, Undo/Reset,
// distinct browser registry, no implicit network or YAML with wrong HWID.
// All fixture URLs and HWIDs are synthetic; never log raw project content.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');

const root = path.resolve(__dirname,'..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-portable-v2-'));
const U = ['https://a.example.invalid/feed','https://b.example.invalid/feed','https://c.example.invalid/feed'];
const H2 = '22222222222222222222222222222222';
const pageUrl = pathToFileURL(path.join(root,'index.html')).href;
const loaded = page => page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);
const collect = page => page.evaluate(() => {
  const p = rbCollectProject();
  delete p.meta.created;
  return p;
});
(async () => {
  const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL || 'msedge',headless:true});
  const ctxA=await browser.newContext({acceptDownloads:true});
  const ctxB=await browser.newContext({acceptDownloads:true});
  const errors=[];
  let probeCount=0;
  const dismissOnImport = new WeakSet();
  async function attach(page) {
    page.on('pageerror',e=>errors.push(e.message));
    page.on('dialog',d=>{
      if (dismissOnImport.has(page)) { dismissOnImport.delete(page); d.dismiss(); }
      else d.accept();
    });
    page.on('request',r=>{if(U.some(url=>r.url().startsWith(url)))probeCount++});
    if(process.env.JS_YAML_PATH)await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({path:process.env.JS_YAML_PATH,contentType:'text/javascript'}));
    await page.goto(pageUrl);await loaded(page);
  }
  const a=await ctxA.newPage();const b=await ctxB.newPage();
  await attach(a);await attach(b);
  // Explicit opt-in: no silent conversion on initial load.
  assert.equal((await collect(a)).schemaVersion,1);
  assert.equal((await collect(b)).schemaVersion,1);
  const localA=await a.evaluate(()=>getActiveDeviceIdentity().hwid);
  const localB=await b.evaluate(()=>getActiveDeviceIdentity().hwid);
  assert.notEqual(localA,localB,'browser-local identities must differ');
  await a.locator('#mihomoInput').fill(U.join('\n'));
  await a.locator('#cfgSubMode').check();
  await a.locator('#deviceIdentityDetails summary').click();
  const before=await collect(a);
  await a.locator('#rbPortableActivateBtn').click();
  const portable=await collect(a);
  assert.equal(portable.schemaVersion,2);
  assert.equal(portable.identities.entries.length,1);
  assert.equal(portable.identities.entries[0].hwid,localA);
  assert.equal(portable.sources.subscriptionSources.length,3);
  assert.equal(await a.evaluate(()=>getActiveDeviceIdentity().hwid),localA);
  assert.equal(await a.locator('#rbPortableReturnBtn').isVisible(),true);
  const [d]=await Promise.all([a.waitForEvent('download'),a.locator('button[onclick="rbSaveProject()"]').click()]);
  const file=path.join(tmp,'portable-a.lgproject.json');await d.saveAs(file);
  const exported=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.equal(exported.schemaVersion,2);
  assert.equal(exported.identities.entries[0].hwid,localA);
  assert.equal(exported.sources.subscriptionSources.length,3);
  assert.deepEqual(before.sources.mainInput,exported.sources.mainInput);
  assert.ok(!JSON.stringify(exported).includes(localB),'other browser identity must not be exported');

  // Browser B has an unrelated active identity. Import must NOT mutate its
  // registry or silently use it for v2 provider headers.
  const registryB=await b.evaluate(()=>localStorage.getItem(DEVICE_IDENTITY_STORAGE_KEY));
  await b.locator('#rbProjectFile').setInputFiles(file);
  await b.waitForFunction(()=>(document.getElementById('toast').textContent||'').includes('v2 загружен'));
  const restored=await collect(b);
  assert.equal(restored.schemaVersion,2);
  assert.deepEqual(restored.identities,exported.identities);
  assert.deepEqual(restored.sources.subscriptionSources,exported.sources.subscriptionSources);
  assert.equal(await b.evaluate(()=>getActiveDeviceIdentity().hwid),localB);
  assert.equal(await b.evaluate(()=>localStorage.getItem(DEVICE_IDENTITY_STORAGE_KEY)),registryB);
  assert.equal(await b.evaluate(()=>{
    try {subscriptionPreviewHeaders();return 'WRONG';}
    catch(e) {return /недоступен/.test(e.message)?'BLOCKED':'WRONG';}
  }),'BLOCKED','preview must not substitute local HWID');
  await b.locator('button[onclick="buildMihomo()"]').click();
  await b.waitForFunction(()=>(document.getElementById('toast').textContent||'').includes('Build временно заблокирован'));
  assert.equal(await b.locator('#mihomoOutput').inputValue(),'','no YAML from incorrect local HWID');
  assert.equal(probeCount,0,'import/Build must never issue network subscription requests');
  const [d2]=await Promise.all([b.waitForEvent('download'),b.locator('button[onclick="rbSaveProject()"]').click()]);
  const file2=path.join(tmp,'portable-b.lgproject.json');await d2.saveAs(file2);
  assert.deepEqual(JSON.parse(fs.readFileSync(file2,'utf8')).identities,exported.identities,'re-export exact same HWIDs');

  // Reject stale URL mapping: no chance to export silently remapped HWID.
  await b.locator('#mihomoInput').fill([U[1],U[0],U[2]].join('\n'));
  const invalidText=await b.evaluate(()=>rbParseProjectText(JSON.stringify(rbCollectProject())));
  assert.equal(invalidText.ok,false,'editing source order without explicit remap fails');
  const downloads=[];
  b.on('download', x=>downloads.push(x.suggestedFilename()));
  await b.locator('button[onclick="rbSaveProject()"]').click();
  assert.match(await b.locator('#toast').textContent(),/не сохранён/);
  assert.equal(downloads.length,0);
  await b.locator('#mihomoInput').fill(U.join('\n'));

  // Browser B import a second project with two identities and a shared H2.
  const two=await a.evaluate(hwid=>{
    const base=rbCollectProject();
    const r=rbPortableAddAndAssign(base,'src-2',{id:'id-b',label:'Provider B',hwid});
    if(!r.ok) return {error:r.error};
    const final=rbPortableAssign(r.project,'src-3','id-b');
    return final.ok ? final.project : {error:final.error};
  },H2);
  assert.ok(!two.error,two.error);
  assert.deepEqual(two.identities.providerBindings.map(k=>k.identityId),[
    two.identities.defaultId,'id-b','id-b']);
  const f3=path.join(tmp,'portable-two.lgproject.json');fs.writeFileSync(f3,JSON.stringify(two));
  const beforeFailed=await collect(b);
  const registryBefore=await b.evaluate(()=>localStorage.getItem(DEVICE_IDENTITY_STORAGE_KEY));
  // Deliberate failed DOM renderer: import must roll back context and controls.
  const failed=await b.evaluate(p=>{
    const old=renderTierCards;
    renderTierCards=()=>{throw new Error('fixture render failure')};
    try {rbApplyProject(p);return false}
    catch(e){return e.message.includes('прежнее состояние')}
    finally{renderTierCards=old}
  },two);
  assert.equal(failed,true);
  assert.deepEqual(await collect(b),beforeFailed,'render failure must restore portable context + inputs');
  assert.equal(await b.evaluate(()=>localStorage.getItem(DEVICE_IDENTITY_STORAGE_KEY)),registryBefore);
  await b.locator('#rbProjectFile').setInputFiles(f3);
  await b.waitForFunction(()=>rbCollectProject().identities?.entries.length===2);
  assert.deepEqual((await collect(b)).identities,two.identities);
  assert.equal(await b.evaluate(()=>localStorage.getItem(DEVICE_IDENTITY_STORAGE_KEY)),registryBefore);
  await b.locator('#rbUndoBtn').click();
  assert.deepEqual(await collect(b),beforeFailed,'Undo must restore previous portable identities');
  assert.equal(await b.evaluate(()=>localStorage.getItem(DEVICE_IDENTITY_STORAGE_KEY)),registryBefore);

  // Cancelled import is an atomic no-op; malformed projects fail validation.
  dismissOnImport.add(b);
  await b.locator('#rbProjectFile').setInputFiles(f3);
  await b.waitForTimeout(200);
  assert.deepEqual(await collect(b),beforeFailed);
  const bad=path.join(tmp,'malformed.lgproject.json');
  fs.writeFileSync(bad,JSON.stringify({...two,identities:{...two.identities,entries:[{...two.identities.entries[0],hwid:'BAD'}]}}));
  await b.locator('#rbProjectFile').setInputFiles(bad);
  await b.waitForFunction(()=>(document.getElementById('toast').textContent||'').startsWith('❌ Проект:'));
  assert.deepEqual(await collect(b),beforeFailed,'invalid project must not change current context');
  const status=(await b.locator('#toast').textContent())+(await b.locator('#rbPortableModeNotice').textContent());
  assert.ok(!status.includes(H2)&&!status.includes(localA)&&!status.includes(localB));
  assert.equal(probeCount,0);

  // Reset and explicitly abandoning v2 must not rewrite browser registry.
  assert.equal(await b.evaluate(()=>rbCommitProjectReset()),true);
  assert.equal((await collect(b)).schemaVersion,1);
  assert.equal(await b.evaluate(()=>localStorage.getItem(DEVICE_IDENTITY_STORAGE_KEY)),registryBefore);
  await b.locator('#rbProjectFile').setInputFiles(f3);
  await b.waitForFunction(()=>rbCollectProject().schemaVersion===2);
  await b.locator('#deviceIdentityDetails summary').click();
  await b.locator('#rbPortableReturnBtn').click();
  assert.equal((await collect(b)).schemaVersion,1);
  assert.equal(await b.evaluate(()=>getActiveDeviceIdentity().hwid),localB);
  assert.equal(await b.evaluate(()=>localStorage.getItem(DEVICE_IDENTITY_STORAGE_KEY)),registryBefore);
  assert.deepEqual(errors,[],'no uncaught browser script failures: '+errors.join('|'));
  await browser.close();
  console.log('PASS portable-project-browser: explicit v2 export/import, cross-browser registry isolation, guarded preview/Build, Undo, fail rollback, Reset');
})().catch(err=>{console.error(err);process.exitCode=1;});
