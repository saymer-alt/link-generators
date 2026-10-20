'use strict';
// #280 Preview↔Build HWID parity. All URLs and identities synthetic; no real
// subscriptions, real network requests, credentials or customer YAML.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const urls=['https://a.example.invalid/feed','https://b.example.invalid/feed','https://c.example.invalid/feed'];
const H2='22222222222222222222222222222222';
async function run() {
  const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
  const context=await browser.newContext();
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  let cancelNextPreview = false;
  const previewConfirmations = [];
  page.on('dialog',d=>{
    if (d.type()==='confirm' && d.message().includes('Получить список серверов для переносимого проекта v2')) {
      previewConfirmations.push(d.message());
      if (cancelNextPreview) { cancelNextPreview=false; void d.dismiss(); return; }
    }
    void d.accept();
  });
  const requests=[];
  page.on('request',r=>{if(urls.some(x=>r.url().startsWith(x)))requests.push(r.url());});
  if(process.env.JS_YAML_PATH) await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({path:process.env.JS_YAML_PATH,contentType:'text/javascript'}));
  await page.goto(pathToFileURL(path.join(root,'index.html')).href);
  await page.waitForFunction(()=>!!globalThis.web4core&&!!globalThis.jsyaml);
  const h1=await page.evaluate(()=>getActiveDeviceIdentity().hwid);
  assert.notEqual(h1,H2);
  await page.fill('#mihomoInput',urls.join('\n'));
  await page.check('#cfgSubMode');
  await page.locator('#deviceIdentityDetails summary').click();
  await page.click('#rbPortableActivateBtn');
  await page.locator('#rbPortableNewSource').selectOption({index:1});
  await page.fill('#rbPortableNewLabel','Provider B');
  await page.fill('#rbPortableNewHwid',H2);
  await page.click('#rbPortableImportHwidBtn');
  const idB=await page.locator('#rbPortableSources select').nth(1).inputValue();
  await page.locator('#rbPortableSources select').nth(2).selectOption(idB);
  assert.deepEqual(await page.evaluate(()=>{
    const p=rbPortablePlanForCurrent();
    return p.providerOverrides.map(x=>x.hwid);
  }),[h1,H2,H2]);

  // Mock only the explicit browser preview API. No actual HTTP request.
  await page.evaluate(()=>{
    window.__fakeSubscriptionHeaders=[];
    web4core.fetchSubscription=async (url,opts)=>{
      window.__fakeSubscriptionHeaders.push({
        url,hwid:opts.headers['x-hwid'],headers:Object.keys(opts.headers).sort()
      });
      return 'vless://00000000-0000-4000-8000-000000000001@192.0.2.10:443?type=tcp#synthetic-node';
    };
  });
  // #307 consent gate: user dismissal MUST be a network no-op, including
  // no POST to a fallback worker. No HWIDs/URLs in disclosure text.
  cancelNextPreview = true;
  await page.evaluate(()=>fetchServerList());
  assert.equal(await page.evaluate(()=>window.__fakeSubscriptionHeaders.length),0);
  assert.match(await page.locator('#toast').textContent(),/отменён/);
  assert.deepEqual(requests,[]);
  await page.evaluate(()=>fetchServerList());
  await page.waitForFunction(()=>serverListState===SERVER_LIST_STATE.SUCCESS);
  assert.ok(previewConfirmations.length >= 2);
  for (const dialog of previewConfirmations) {
    assert.match(dialog,/Cloudflare Worker/);
    assert.match(dialog,/редирект/);
    assert.ok(!dialog.includes(h1) && !dialog.includes(H2) && !urls.some(url=>dialog.includes(url)));
  }
  const preview=await page.evaluate(()=>window.__fakeSubscriptionHeaders);
  assert.deepEqual(preview.map(x=>x.url),urls);
  assert.deepEqual(preview.map(x=>x.hwid),[h1,H2,H2]);
  for(const p of preview)assert.deepEqual(p.headers,['x-device-model','x-hwid']);
  assert.deepEqual(requests,[],'no actual subscription network requests');
  // Local device registry must not change.
  assert.equal(await page.evaluate(()=>getActiveDeviceIdentity().hwid),h1);

  // Reordered source input is stale: NO preview network calls or silent HWID swap.
  await page.fill('#mihomoInput',[urls[1],urls[0],urls[2]].join('\n'));
  await page.evaluate(()=>fetchServerList());
  assert.equal((await page.evaluate(()=>window.__fakeSubscriptionHeaders)).length,3);
  assert.match(await page.locator('#toast').textContent(),/v2.*URL/);
  await page.fill('#mihomoInput',urls.join('\n'));
  // Missing mappings and unsupported Sub OFF/fallback never contact providers.
  await page.uncheck('#cfgSubMode');
  await page.evaluate(()=>fetchServerList());
  assert.equal((await page.evaluate(()=>window.__fakeSubscriptionHeaders)).length,3);
  await page.check('#cfgSubMode');

  const actualCandidateRuntime = process.env.EXPECT_V2_ENGINE === '1';
  if (actualCandidateRuntime) {
    // PR #21 candidate is compiled via read-only CI and copied only into
    // ephemeral workspace: this is the real source-engine end-to-end path.
    assert.equal(await page.evaluate(()=>rbPortableRuntimeCanBuild(web4core)),true,
      'actual candidate engine must prove its own header contract');
    await page.evaluate(()=>{
      const base=web4core.buildFromRequest;
      window.__lastV2Request=null;
      web4core.buildFromRequest=(req)=>{
        if(req.options?.providerOverrides) window.__lastV2Request={
          input:req.input,hwids:req.options.providerOverrides.map(x=>x.hwid)};
        return base(req);
      };
    });
  } else {
    // The tracked v1.11.2 runtime must fail closed; synthetic adapter below
    // is ONLY a consumer contract unit test, not evidence for engine readiness.
    assert.equal(await page.evaluate(()=>rbPortableRuntimeCanBuild(web4core)),false);
    await page.evaluate(()=>{ void buildMihomo(); });
    assert.match(await page.locator('#toast').textContent(),/web4core.*HWID/);
    assert.equal(await page.locator('#mihomoOutput').inputValue(),'');
    await page.evaluate(()=>{
      const base=web4core.buildFromRequest;
      window.__lastV2Request=null;
      web4core.buildFromRequest=(req)=>{
        const out=base(req);
        if(!req.options?.providerOverrides)return out;
        const doc=jsyaml.load(out.data);
        const overrides=req.options.providerOverrides;
        for(const p of Object.values(doc['proxy-providers']||{})){
          const match=overrides.find(x=>x.sourceUrl===p.url);
          if(match)p.header['x-hwid']=[match.hwid];
        }
        window.__lastV2Request={input:req.input,hwids:overrides.map(x=>x.hwid)};
        return {...out,data:jsyaml.dump(doc,{lineWidth:-1})};
      };
    });
    assert.equal(await page.evaluate(()=>rbPortableRuntimeCanBuild(web4core)),true);
  }
  await page.evaluate(()=>{ void buildMihomo(); });
  await page.waitForFunction(()=>document.getElementById('mihomoOutput').value.includes('proxy-providers'));
  const built=await page.evaluate(()=>{
    const text=document.getElementById('mihomoOutput').value;
    const doc=jsyaml.load(text);
    const p=Object.values(doc['proxy-providers']||{});
    return {headers:p.map(x=>x.header?.['x-hwid']?.[0]),urls:p.map(x=>x.url),
      opts:window.__lastV2Request?.hwids,
      verified:rbPortableOutputHasExactHwids(text,rbPortablePlanForCurrent())};
  });
  assert.deepEqual(built.headers,[h1,H2,H2]);
  assert.deepEqual(built.urls,urls);
  assert.deepEqual(built.opts,[h1,H2,H2]);
  assert.equal(built.verified,true);
  // Synthetic fixture only. Candidate CI checks it against real Mihomo
  // before any promotion; no real URLs, keys or service credentials.
  if (process.env.MIHOMO_CANDIDATE_CONFIG) {
    const yaml=await page.locator('#mihomoOutput').inputValue();
    fs.writeFileSync(process.env.MIHOMO_CANDIDATE_CONFIG,yaml);
  }

  // Bad runtime output is NEVER allowed to overwrite YAML as a fresh Build.
  await page.evaluate(()=>{
    const base=web4core.buildFromRequest;
    web4core.buildFromRequest=(req)=>{
      const out=base(req);
      if(req.input.includes('portable-a.example.invalid/fixture'))return out;
      if(!req.options?.providerOverrides)return out;
      const doc=jsyaml.load(out.data);
      const first=Object.values(doc['proxy-providers']||{})[0];
      if(first) first.header['x-hwid']=['44444444444444444444444444444444'];
      return {...out,data:jsyaml.dump(doc,{lineWidth:-1})};
    };
    document.getElementById('mihomoOutput').value='';
  });
  // Feature probe may fail with this wrapper or exact final parity should fail.
  await page.evaluate(()=>{ void buildMihomo(); });
  assert.equal(await page.locator('#mihomoOutput').inputValue(),'');
  assert.match(await page.locator('#toast').textContent(),/v2 Build|веб4кор|web4core|HWID/i);
  assert.deepEqual(requests,[]);
  const msg=await page.locator('#toast').textContent();
  assert.ok(!msg.includes(h1)&&!msg.includes(H2)&&!urls.some(u=>msg.includes(u)),'status redacted');
  assert.deepEqual(errors,[],'no browser exceptions: '+errors.join('|'));
  await browser.close();
  console.log('PASS portable-preview-build-browser: exact per-source preview, stale fail-closed, runtime probe, YAML parity, negative output');
}
run().catch(e=>{console.error(e);process.exit(1);});
