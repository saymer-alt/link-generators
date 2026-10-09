// Deterministic synthetic lab. No owner data and no network. Seed v111-field-20261009.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const seed='v111-field-20261009';
const key=label=>crypto.createHash('sha256').update(seed+':'+label).digest('base64');
function scenarios(){
 const list=[];
 for(const stack of ['off','gvisor','system','mips'])list.push({id:'router-'+stack,profile:'router',stack,dns:false,sub:true});
 for(const sub of [false,true])list.push({id:'local-sub-'+sub,profile:'vps-local',stack:'off',dns:false,sub});
 for(const stack of ['gvisor','system','mips'])for(const dns of [false,true])list.push({id:'gateway-'+stack+'-dns-'+dns,profile:'vps-gateway',stack,dns,sub:true});
 for(const [id,extra] of Object.entries({
  'direct-links-inline':{sub:false,links:true},'inline-subscriptions':{sub:false},
  'dpr-tiered':{policy:true,tiered:true},'awg-dialer':{links:true,dialer:true},
  'awl-fallback':{awl:true},'server-selection':{serverList:true},
  'metacubexd':{dashboard:'metacubexd'},'six-subscriptions-eight-profiles':{subs:6,profiles:8},
  'eight-subscriptions':{subs:8},'duplicate-subscriptions':{subs:3,duplicates:true},
  'unicode-names':{links:true,unicode:true},'per-proxy':{sub:false,links:true,perProxy:true},
  'dpr-only':{policy:true},'tiered-only':{tiered:true},'dialer-two-level':{chain:true},'unknown-sections':{unknown:true},'independent-server-yaml':{serverYaml:true}
 }))list.push({id,profile:'router',stack:'gvisor',sub:true,...extra});
 return list;
}
function createLab(dir){
 const root=path.resolve(__dirname,'../..');dir=path.resolve(dir);
 for(const d of ['router','vps-local','vps-gateway','subscriptions','wireguard','amneziawg','routing','reverse-build','invalid'])fs.mkdirSync(path.join(dir,'fixtures',d),{recursive:true});
 for(const d of ['generated','results','reports'])fs.mkdirSync(path.join(dir,d),{recursive:true});
 const profiles=[];
 for(let i=0;i<8;i++){
  const kind=['wg','awg20','awg31'][i%3],template={wg:'wg-simple-a.conf',awg20:'awg-keepalive-30.conf',awg31:'awg31.conf'}[kind];
  let text=fs.readFileSync(path.join(root,'tests','fixtures',template),'utf8');
  text=text.replace(/^DNS\s*=.*$/m,'DNS = 192.0.2.53').replace(/^PrivateKey\s*=.*$/m,'PrivateKey = '+key('private-'+i)).replace(/^PublicKey\s*=.*$/m,'PublicKey = '+key('peer-'+i)).replace(/^Address\s*=.*$/m,'Address = 10.99.0.'+(i+2)+'/32').replace(/^Endpoint\s*=.*$/m,'Endpoint = 192.0.2.'+(i+10)+':51820');
  const file=path.join(dir,'fixtures',kind==='wg'?'wireguard':'amneziawg',kind+'-'+i+'.conf');fs.writeFileSync(file,text);profiles.push(file);
 }
 const cases=scenarios();
 for(const c of cases)fs.writeFileSync(path.join(dir,'fixtures',c.profile,c.id+'.json'),JSON.stringify({...c,seed,expected:'VALID; exact Project Restore; YAML Reverse parity only for supported subset'},null,2));
 const negatives=['invalid-key','duplicate-proxy','missing-target','route-cycle','unknown-rule-provider','malformed-yaml','project-newer-schema','project-malformed-json','project-wrong-type','project-duplicate-id','builder-empty','builder-invalid-uri','wg-missing-address','wg-missing-key','wg-missing-endpoint','wg-invalid-address','wg-invalid-endpoint','wg-invalid-key','deleted-dialer-target','dialer-cycle'];
 fs.writeFileSync(path.join(dir,'fixtures','subscriptions','mock.txt'),'# In-memory fetchSubscription stub only; no HTTP requests.\nhttps://field.example.invalid/feed\n');
 fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({seed,positive:cases,negative:negatives,keys:'deterministic SHA256-derived 32-byte synthetic values; no handshake proof'},null,2));
 fs.writeFileSync(path.join(dir,'README.md'),'# Local synthetic laboratory\n\nSeed: '+seed+'. All keys are public synthetic test values, never use for tunnels. TEST-NET endpoints and example.invalid only. No owner data. Generated configs/projects/results remain ignored.\n\nRun: node tools/synthetic-fieldtest/generate.cjs [directory]\nThen set FIELDTEST_LAB_DIR to this absolute directory and run node tests/field-acceptance-browser.cjs with NODE_PATH/JS_YAML_PATH, optionally MIHOMO_BIN. No network tests; subscriptions mocked in memory.\n');
 return {dir,profiles,cases,negatives,seed};
}
module.exports={scenarios,createLab};
if(require.main===module){const lab=createLab(process.argv[2]||path.join(__dirname,'../../fieldtest-private'));console.log('Synthetic lab generated: '+lab.cases.length+' positive + '+lab.negatives.length+' negative; values hidden');}
