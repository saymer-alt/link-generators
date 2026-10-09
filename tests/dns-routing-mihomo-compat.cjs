// Parse-only synthetic DNS contracts, no server/start/network requests.
const assert=require('node:assert/strict');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {spawnSync}=require('node:child_process');
const yaml=require(process.env.JS_YAML_PATH);
assert.ok(process.env.MIHOMO_BIN,'MIHOMO_BIN required');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lg-dns-compat-'));
const cases=[
 ['disabled-structural',{enable:false,'respect-rules':true},false],
 ['omitted-structural',{'respect-rules':true},false],
 ['disabled-valid',{enable:false,nameserver:['192.0.2.53']},true],
 ['explicit-proxy',{enable:true,nameserver:['https://192.0.2.53/dns-query#PROXY'],'nameserver-policy':{'+.x.test':['tls://192.0.2.53#PROXY','quic://192.0.2.54#PROXY']}},true],
 ['respect-rules',{enable:true,'respect-rules':true,'proxy-server-nameserver':['192.0.2.53'],nameserver:['https://192.0.2.54/dns-query']},true],
 ['psns-policy-empty',{enable:false,'proxy-server-nameserver-policy':{'+.x.test':['192.0.2.53']}},false],
 ['pass-rule',{enable:true,nameserver:['192.0.2.53']},true,['DOMAIN,x.test,PASS','DOMAIN,x.test,PROXY','MATCH,DIRECT']]
];
try {
 for(const [name,dns,valid,rules] of cases){
  const doc={'mixed-port':17890,mode:'rule',dns,'proxy-groups':[{name:'PROXY',type:'select',proxies:['DIRECT']}],rules:rules||['MATCH,DIRECT']};
  const file=path.join(dir,name+'.yaml');fs.writeFileSync(file,yaml.dump(doc));
  const r=spawnSync(process.env.MIHOMO_BIN,['-t','-d',dir,'-f',file],{encoding:'utf8',timeout:20000});
  assert.ifError(r.error);
  assert.equal(r.status===0,valid,name+': unexpected parse verdict');
  if(!valid)assert.match(r.stdout+r.stderr,/proxy-server-nameserver/);
 }
 console.log('PASS dns-routing-mihomo-compat: '+cases.length+' parse-only cases');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
