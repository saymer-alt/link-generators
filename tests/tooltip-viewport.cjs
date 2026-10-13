// #262: same behavioral probe against stable (RED) and topic (GREEN).
const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const pw = require('playwright');
const root = process.env.TEST_ROOT || path.resolve(__dirname, '..');
(async () => {
  for (const engine of (process.env.TEST_ENGINES || 'chromium,firefox,webkit').split(',')) {
    const browser = await pw[engine].launch({headless:true});
    try {
      const page = await browser.newPage();
      if (process.env.JS_YAML_PATH) await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({path:process.env.JS_YAML_PATH,contentType:'text/javascript'}));
      await page.goto(pathToFileURL(path.join(root,'index.html')).href);
      await page.locator('button.tab', {hasText:'Mihomo Config Builder'}).click();
      await page.evaluate(() => {
        const host = document.createElement('div'); host.id='dynamicHelp';
        host.append(makeCtxHelp('Динамическая WG подсказка. '.repeat(30),'WG regression'));
        document.getElementById('mihomoInput').after(host);
      });
      async function geometry(btn, context) {
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        const r = await btn.evaluate(b => {
          const p=b.parentElement.querySelector('.ctx-help-pop'), r=p.getBoundingClientRect();
          return {visible:getComputedStyle(p).display!=='none',left:r.left,right:r.right,top:r.top,bottom:r.bottom,w:document.documentElement.clientWidth,h:document.documentElement.clientHeight};
        });
        assert.ok(r.visible && r.left>=7 && r.right<=r.w-7 && r.top>=7 && r.bottom<=r.h-7, engine+' '+context+' '+JSON.stringify(r));
      }
      // CSS viewport reductions model reduced layout space, NOT native browser zoom.
      for (const width of (process.env.TEST_WIDTHS || '1366,320,390,455,683,768,1024').split(',').map(Number)) {
        await page.setViewportSize({width,height:width===455?256:720});
        for (const label of ['Allow LAN','TUN Interface','Mixed Port','WG regression']) {
          const btn=page.getByRole('button',{name:'Подсказка: '+label,exact:true});
          await btn.scrollIntoViewIfNeeded();
          const before=await page.locator('#cfgTun').isChecked();
          const docBounds=()=>btn.evaluate(b=>{const r=b.getBoundingClientRect();return {x:r.x,y:r.y+scrollY,width:r.width,height:r.height};});
          const bounds=await docBounds();
          await btn.hover(); await geometry(btn,width+' hover '+label);
          await btn.focus(); await geometry(btn,width+' focus '+label);
          await btn.press('Enter'); await geometry(btn,width+' click '+label);
          const after=await docBounds();
          for(const k of Object.keys(bounds)) assert.ok(Math.abs(after[k]-bounds[k])<0.1,'tooltip does not shift trigger layout: '+k);
          assert.equal(await page.locator('#cfgTun').isChecked(),before,'help does not toggle label checkbox');
          await page.evaluate(()=>window.scrollBy(0,12));
          await geometry(btn,width+' scroll '+label);
          await page.setViewportSize({width:width+1,height:width===455?257:721});
          await geometry(btn,width+' resize '+label);
          await page.mouse.move(0,0); await page.keyboard.press('Escape');
          assert.equal(await btn.getAttribute('aria-expanded'),'false');
          assert.equal(await btn.evaluate(b=>getComputedStyle(b.parentElement.querySelector('.ctx-help-pop')).display),'none');
        }
      }
      // Deterministic classic-scrollbar reservation model, in addition to real
      // geometry above (headless platforms may use overlay scrollbars).
      await page.setViewportSize({width:320,height:720});
      await page.evaluate(()=>Object.defineProperty(document.documentElement,'clientWidth',{configurable:true,get:()=>innerWidth-17}));
      const reserved=page.getByRole('button',{name:'Подсказка: Allow LAN',exact:true});
      await reserved.scrollIntoViewIfNeeded();await reserved.hover();
      await geometry(reserved,'17px reserved scrollbar area');
      console.log(engine+': tooltip geometry/keyboard/scroll/resize/dynamic PASS');
    } finally {await browser.close();}
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
