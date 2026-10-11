// Transient Playwright runtime supplied externally. Results contain no configs.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),pw=require('playwright');
const output=path.resolve(process.env.TEST_OUTPUT_DIR||process.argv[2]||'fieldtest-private/results/browser-matrix');
const root=path.resolve(process.env.AUDIT_ROOT||path.join(__dirname,'../..'));
fs.mkdirSync(output,{recursive:true});
(async()=>{
 const results=[];
 for(const [name,engine,channel] of [['Chromium','chromium','chromium'],['Edge','chromium','msedge'],['Firefox','firefox',''],['WebKit','webkit','']]){
  const dest=path.join(output,name.toLowerCase());fs.mkdirSync(dest,{recursive:true});
  let browser;
  try{browser=await pw[engine].launch({headless:true,...(channel?{channel}:{})});}
  catch(e){results.push({browser:name,status:'NOT RUN',reason:'Browser launch unavailable: '+String(e.message).split('\n')[0]});continue;}
  const version=browser.version();await browser.close();
  const r=spawnSync(process.execPath,[path.join(__dirname,'../../tests/final-release-browser.cjs')],{cwd:root,env:{...process.env,AUDIT_ROOT:root,BROWSER_ENGINE:engine,BROWSER_CHANNEL:channel,TEST_OUTPUT_DIR:dest,FIELDTEST_LAB_DIR:''},encoding:'utf8',timeout:180000,maxBuffer:1024*1024});
  fs.writeFileSync(path.join(dest,'runner.log'),(r.stdout||'')+(r.stderr||'')+(r.error?'\n'+r.error.message:''));
  results.push({browser:name,version,status:r.status===0?'PASS':'FAIL',exit:r.status});
  console.log(name+': '+results.at(-1).status);
 }
 fs.writeFileSync(path.join(output,'matrix.json'),JSON.stringify(results,null,2));
 process.exitCode=results.some(r=>r.status==='FAIL')?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
