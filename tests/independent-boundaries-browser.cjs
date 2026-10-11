// Independent negative regressions: synthetic inputs, no live requests.
const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');
(async () => {
 const browser = await chromium.launch({channel:process.env.BROWSER_CHANNEL || 'msedge',headless:true});
 try {
  const page = await browser.newPage();
  await page.route('https://**', r => r.request().url().startsWith('https://cdn.jsdelivr.net/') ? r.fulfill({path:process.env.JS_YAML_PATH,contentType:'text/javascript'}) : r.abort());
  await page.goto(pathToFileURL(path.join(process.env.AUDIT_ROOT || path.resolve(__dirname,'..'),'index.html')).href);
  await page.waitForFunction(() => !!globalThis.jsyaml && !!globalThis.web4core);
  const result = await page.evaluate(() => {
   const valid=rbCollectProject(), parse=p=>rbParseProjectText(JSON.stringify(p)).ok;
   const bool=JSON.parse(JSON.stringify(valid)); bool.options.addTun='false';
   const nested=JSON.parse(JSON.stringify(valid)); nested.passthrough=JSON.parse('{"__proto__":{"polluted":true}}');
   const deep=JSON.parse(JSON.stringify(valid)); let v=deep; for(let i=0;i<70;i++)v=v.child={};
   const ids=JSON.parse(JSON.stringify(valid)); const w={id:1,filename:'synthetic.conf',mode:'direct',target:'',bean:{proto:'wireguard',name:'SYNTH',wireguard:{}}}; ids.wgProfiles=[w,w];
   const secret='SYNTH_ONLY_LONG_CREDENTIAL_'+ 'x'.repeat(90);
   const doc={proxies:[{name:secret,type:'ss',server:'192.0.2.1',port:443,password:secret,cipher:'aes-128-gcm'}],'proxy-groups':[{name:'G',type:'select',proxies:[secret]}],rules:['MATCH,G']};
   vrgRenderInto('csVrgSvgWrap',doc,false,'csVrgTextAltOut',s=>csRedactText(s,doc));
   const studio=Array.from(document.querySelectorAll('#csVrgSvgWrap [aria-label]')).map(e=>e.getAttribute('aria-label')).join('\n');
   vrgRenderInto('vrgSvgWrap',doc,false); vrgFillFocusSelect('vrgFocusSelect',doc);
   const builder=document.getElementById('vrgSvgWrap').textContent+'\n'+document.getElementById('vrgFocusSelect').outerHTML;
   return {valid:parse(valid),bool:parse(bool),nested:parse(nested),deep:parse(deep),ids:parse(ids),studio,builder};
  });
  assert.equal(result.valid,true);
  for(const key of ['bool','nested','deep','ids'])assert.equal(result[key],false,key+' must fail closed');
  assert.ok(!result.studio.includes('SYNTH_ONLY_LONG_CREDENTIAL_'),'redact before aria truncation');
  assert.ok(!result.builder.includes('SYNTH_ONLY_LONG_CREDENTIAL_'),'Builder SVG and selector must redact');
  console.log('PASS independent-boundaries-browser: 7 checks');
 } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
