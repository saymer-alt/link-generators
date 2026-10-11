// Config Studio × реальный Mihomo (#178, PHASE 28): исходный синтетический
// фиксстурный конфиг и его правленые варианты обязаны проходить `mihomo -t`.
// Только синтетика (RFC5737/example.invalid/dummy-ключи). env: MIHOMO_BIN обязателен.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const MIHOMO = process.env.MIHOMO_BIN;
assert.ok(MIHOMO && fs.existsSync(MIHOMO), 'MIHOMO_BIN не задан или не существует');

const CSYamlsSrc = fs.readFileSync(path.join(__dirname, '..', 'cs-yaml.runtime.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const grab = (a, b) => html.slice(html.lastIndexOf('\n', html.indexOf(a)) + 1, html.indexOf('\n', html.indexOf(b)) + 1);
const api = new Function(CSYamlsSrc + '\n' + grab('CS-CORE-START', 'CS-CORE-END') + '\n' + grab('CS-EDITOR-START', 'CS-EDITOR-END') + '\nreturn { CSYaml: CSYaml, csReplay };')();
const CSY = api.CSYaml;

const FIXTURE = [
  'mixed-port: 7890',
  'mode: rule',
  'log-level: warning',
  'proxies:',
  '  - name: Alpha-SS',
  '    type: ss',
  '    server: 198.51.100.10',
  '    port: 8443',
  '    password: compat-synth-pass-a',
  '    cipher: aes-128-gcm',
  '  - name: Beta-SS',
  '    type: ss',
  '    server: 198.51.100.20',
  '    port: 8443',
  '    password: compat-synth-pass-b',
  '    cipher: aes-128-gcm',
  'proxy-groups:',
  '  - name: MAIN',
  '    type: select',
  '    proxies:',
  '      - Alpha-SS',
  '      - Beta-SS',
  '      - DIRECT',
  'rules:',
  '  - DOMAIN-SUFFIX,example.invalid,MAIN',
  '  - MATCH,DIRECT'
].join('\n');

const SCENARIOS = [
  ['original', []],
  ['server-edit', [{ opKind: 'field-edit', type: 'proxy', name: 'Beta-SS', field: 'server', newText: '203.0.113.20' }]],
  ['port-edit', [{ opKind: 'field-edit', type: 'proxy', name: 'Beta-SS', field: 'port', newText: '9443' }]],
  ['rename-with-refs', [{ opKind: 'rename', type: 'proxy', name: 'Beta-SS', new: 'Beta-SS-2' }]],
  ['group-members', [{ opKind: 'group-members', name: 'MAIN', members: ['DIRECT', 'Alpha-SS', 'Beta-SS'] }]],
  ['rule-target', [{ opKind: 'rule-target', ruleIndex: 1, newTarget: 'Alpha-SS' }]],
  ['add-proxy', [{ opKind: 'add', fields: { name: 'Gamma-SS', type: 'ss', server: '203.0.113.30', port: '8443', password: 'compat-synth-pass-c', cipher: 'aes-128-gcm' } }]],
  ['UX52-add-provider', [{opKind:'add-provider',fields:{name:'owner-sub',url:'https://sub.example.invalid/token/SYNTH_ONLY',interval:'86400',path:'providers/owner.yaml',proxy:'DIRECT',healthEnable:true,healthUrl:'https://health.example.invalid/check',healthInterval:'300',expectedStatus:'200/204'}}]],
  ['UX52-provider-rename-download-target', [
    {opKind:'add-provider',fields:{name:'owner-sub',url:'https://sub.example.invalid/token/SYNTH_ONLY',interval:'86400',path:'providers/owner.yaml',proxy:'Alpha-SS',healthEnable:false,healthUrl:'https://health.example.invalid/check',healthInterval:'300'}},
    {opKind:'rename',type:'proxy',name:'Alpha-SS',new:'Renamed-download'}
  ]],
  ['multi-edit', [
    { opKind: 'field-edit', type: 'proxy', name: 'Beta-SS', field: 'server', newText: '203.0.113.20' },
    { opKind: 'rename', type: 'proxy', name: 'Beta-SS', new: 'Beta-SS-2' },
    { opKind: 'rule-target', ruleIndex: 0, newTarget: 'Alpha-SS' }
  ]]
];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-compat-'));
// Cache prevents any subscription fetch; -t is a syntax check, not a handshake.
fs.mkdirSync(path.join(dir,'providers'));
fs.writeFileSync(path.join(dir,'providers','owner.yaml'),'proxies:\n  - {name: cached, type: ss, server: 192.0.2.1, port: 443, cipher: aes-128-gcm, password: SYNTH_ONLY}\n');
let cases = 0;
for (const [name, ops] of SCENARIOS) {
  const { text } = api.csReplay(FIXTURE, ops, CSY);
  const file = path.join(dir, 'config-' + name + '.yaml');
  fs.writeFileSync(file, text);
  let out;
  try {
    out = execFileSync(MIHOMO, ['-t', '-d', dir, '-f', file], { timeout: 60000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    out = (e.stdout || '') + (e.stderr || '');
    assert.fail(name + ': mihomo -t отверг конфиг: ' + out.slice(0, 300));
  }
  assert.ok(/configuration file .* test is successful|test is successful/i.test(out) || !/error|fatal/i.test(out), name + ': неожиданный вывод: ' + out.slice(0, 200));
  cases++;
  console.log('  ok —', name);
}
const vm=require('node:vm');
const context=vm.createContext({URL,URLSearchParams,TextEncoder,TextDecoder,atob,btoa});
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','web4core.runtime.js'),'utf8'),context);
const core=context.web4core;
const wg=core.parseWireGuardConf(fs.readFileSync(path.join(__dirname,'fixtures','wg-simple-a.conf'),'utf8'),'WG');
const awg=core.parseWireGuardConf(fs.readFileSync(path.join(__dirname,'fixtures','awg31.conf'),'utf8'),'AWG');
const projectApi=new Function(grab('RB-CORE-START','RB-CORE-END')+'\nreturn {rbParseProjectText};')();
for(const provider of [false,true])for(const [version,storedName,target] of [[1,'','SHARED-DIALER'],[1,'','WARP-DIALER'],[1,'WARP-DIALER','WARP-DIALER'],[1,'Custom-Dialer','Custom-Dialer'],[2,'','SHARED-DIALER'],[2,'WARP-DIALER','WARP-DIALER']]){
  const project={schemaVersion:version,sources:{mainInput:'',fallbackInput:'',subMode:provider,autoWhitelist:false},options:{profile:'router'},dialer:{name:storedName,members:provider?'':'DIRECT',providers:provider?'https://sub.example.invalid/feed':''},domainPolicy:{enabled:false,cards:[]},tiered:{enabled:false,cards:[]},wgProfiles:[wg,awg].map((b,i)=>({id:i+1,filename:i?'awg31.conf':'wg-simple-a.conf',mode:'proxy',target,bean:{...b,wireguard:{...b.wireguard,dialerProxy:target}}}))};
  const parsed=projectApi.rbParseProjectText(JSON.stringify(project));assert.equal(parsed.ok,true);assert.equal(parsed.project.schemaVersion,1);assert.deepEqual(parsed.project.wgProfiles,JSON.parse(JSON.stringify(project.wgProfiles)));
  const round=projectApi.rbParseProjectText(JSON.stringify(parsed.project));assert.deepEqual(round,parsed);
  const name=parsed.project.dialer.name;
  assert.equal(name||'SHARED-DIALER',target);
  const beans=parsed.project.wgProfiles.map(w=>w.bean);
  const options={addTun:false,addSocks:true,webUI:false,mihomoSubscriptionMode:false,wgDialerProxy:name,wgDialerGroupOnly:true,wgDialerGroupMembers:['DIRECT']};
  const url='https://sub.example.invalid/feed';
  if(provider){options.mihomoSubscriptionMode=true;delete options.wgDialerGroupMembers;options.wgDialerProviders=[url];}
  const text=core.buildFromRequest({core:'mihomo',input:provider?url:'',wgBeans:beans,options}).data;
  for(const spec of Object.values(CSY.parse(text)['proxy-providers'] || {})){
    if(!spec.path)continue;const cache=path.resolve(dir,spec.path);assert.ok(cache.startsWith(dir+path.sep));fs.mkdirSync(path.dirname(cache),{recursive:true});
    fs.writeFileSync(cache,'proxies: [{name: cached, type: ss, server: 192.0.2.1, port: 443, cipher: aes-128-gcm, password: SYNTH_ONLY}]\n');
  }
  assert.equal((text.match(new RegExp('dialer-proxy: '+target,'g'))||[]).length,2);
  const file=path.join(dir,'dialer-'+target+'.yaml');fs.writeFileSync(file,text);
  execFileSync(MIHOMO,['-t','-d',dir,'-f',file],{timeout:60000,stdio:['ignore','pipe','pipe']});
  cases++;console.log('  ok — UX54 project v'+version+' name='+JSON.stringify(storedName)+' multiple WG/AWG '+target+' provider='+provider);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log('PASS config-studio-compat: ' + cases + ' сценариев против реального mihomo');
