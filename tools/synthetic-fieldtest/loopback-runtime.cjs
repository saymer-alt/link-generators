// Изолированный runtime lab: только IPv4 loopback, TUN/системные DNS/маршруты не меняются.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),dgram=require('node:dgram'),net=require('node:net'),assert=require('node:assert/strict'),{spawn,spawnSync}=require('node:child_process');
const yaml=require(process.env.JS_YAML_PATH);assert.ok(process.env.MIHOMO_BIN,'MIHOMO_BIN required');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lg-loopback-')),servers=[],children=[],result={parseAccepted:0,processStarted:0,localTrafficPassed:[],failoverObserved:false,recoveryObserved:false,remoteHandshake:'NOT RUN',unexpected:[]};
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>{servers.push(server);resolve(server.address().port);}));
const free=async()=>{const s=net.createServer();const p=await listen(s);await new Promise(r=>s.close(r));return p;};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,ms=12000){const start=Date.now();let last;while(Date.now()-start<ms){try{const r=await fn();if(r)return r;}catch(e){last=e.name;}await wait(100);}throw Error('loopback condition timeout '+(last||''));}
const request=(port,route,headers={})=>new Promise((resolve,reject)=>{const r=http.get({hostname:'127.0.0.1',port,path:route,headers:{...headers,...(route.startsWith('http://')?{Host:new URL(route).host}:{})},timeout:1500},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));});r.on('timeout',()=>r.destroy(Error('local timeout')));r.on('error',reject);});
(async()=>{
 let udp;
 try{
  const target=http.createServer((req,res)=>{res.writeHead(req.url==='/health'?204:200,req.headers['x-lab-hop']?{'x-lab-hop':req.headers['x-lab-hop']}:{ });res.end(req.url==='/health'?'':'SYNTH_LOOPBACK_OK');});const targetPort=await listen(target);
  let dnsQueries=0;udp=dgram.createSocket('udp4');await new Promise(r=>udp.bind(0,'127.0.0.1',r));const dnsPort=udp.address().port;
  udp.on('message',(msg,remote)=>{dnsQueries++;let end=12;while(end<msg.length&&msg[end])end+=msg[end]+1;end+=5;if(end>msg.length)return;const question=msg.subarray(12,end),head=Buffer.from(msg.subarray(0,12));head.writeUInt16BE(0x8180,2);head.writeUInt16BE(1,6);head.writeUInt16BE(0,8);head.writeUInt16BE(0,10);const answer=Buffer.from([0xc0,0x0c,0,1,0,1,0,0,0,1,0,4,127,0,0,1]);udp.send(Buffer.concat([head,question,answer]),remote.port,remote.address);});
  let rejectedExternal=0;
  function proxy(name){const server=http.createServer((req,res)=>{let u;try{u=new URL(req.url);}catch(_){res.writeHead(400);return res.end();}if(u.hostname!=='127.0.0.1'||Number(u.port)!==targetPort){rejectedExternal++;res.writeHead(403);return res.end();}const upstream=http.request({host:'127.0.0.1',port:targetPort,path:u.pathname,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,{...r.headers,'x-lab-hop':name});r.pipe(res);});upstream.on('error',()=>{res.writeHead(502);res.end();});req.pipe(upstream);});
   server.sockets=new Set();server.on('connection',s=>{server.sockets.add(s);s.on('close',()=>server.sockets.delete(s));});
   server.on('connect',(req,socket,head)=>{
    if(req.url!=='127.0.0.1:'+targetPort){rejectedExternal++;socket.destroy();return;}
    const upstream=net.connect(targetPort,'127.0.0.1',()=>{socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);let first=true;socket.on('data',chunk=>{if(first){first=false;upstream.write(chunk.toString().replace('\r\n','\r\nX-Lab-Hop: '+name+'\r\n'));}else upstream.write(chunk);});upstream.pipe(socket);});
    upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());socket.on('close',()=>upstream.destroy());
   });return server;}
  let a=proxy('A'),b=proxy('B');const aPort=await listen(a),bPort=await listen(b);
  for(const dnsOn of [false,true]){
   const mixed=await free(),controller=await free(),dnsListen=await free();
   const config={'mixed-port':mixed,'bind-address':'127.0.0.1','allow-lan':false,'external-controller':'127.0.0.1:'+controller,secret:'SYNTH_LOOPBACK_CONTROLLER',mode:'rule',hosts:{localhost:'127.0.0.1'},'log-level':'silent',ipv6:false,tun:{enable:false},sniffer:{enable:false},profile:{'store-selected':false,'store-fake-ip':false},dns:{enable:dnsOn,listen:'127.0.0.1:'+dnsListen,'use-hosts':true,'use-system-hosts':false,'enhanced-mode':'redir-host',nameserver:['udp://127.0.0.1:'+dnsPort],'default-nameserver':['127.0.0.1:'+dnsPort]},proxies:[{name:'A',type:'http',server:'127.0.0.1',port:aPort},{name:'B',type:'http',server:'127.0.0.1',port:bPort}],'proxy-groups':[{name:'LAB',type:'fallback',proxies:['A','B'],url:'http://127.0.0.1:'+targetPort+'/health',interval:1,lazy:false,timeout:500}],rules:['DOMAIN,localhost,DIRECT','DOMAIN,synthetic.test,DIRECT','MATCH,LAB']};
   const file=path.join(dir,'config-'+dnsOn+'.yaml');fs.writeFileSync(file,yaml.dump(config));
   const parsed=spawnSync(process.env.MIHOMO_BIN,['-t','-d',dir,'-f',file],{encoding:'utf8',timeout:15000});assert.equal(parsed.status,0,'loopback parse acceptance');result.parseAccepted++;
   const child=spawn(process.env.MIHOMO_BIN,['-d',dir,'-f',file],{stdio:['ignore','pipe','pipe'],windowsHide:true});children.push(child);let log='';child.stdout.on('data',c=>log+=c);child.stderr.on('data',c=>log+=c);child.__getLog=()=>log;
   const auth={Authorization:'Bearer SYNTH_LOOPBACK_CONTROLLER'};await until(async()=>{if(child.exitCode!==null)throw Error('process exited');const r=await request(controller,'/version',auth);return r.status===200;});result.processStarted++;
   const raw='http://127.0.0.1:'+targetPort+'/ping';const through=await request(mixed,raw);assert.equal(through.status,200);assert.equal(through.body,'SYNTH_LOOPBACK_OK');assert.equal(through.headers['x-lab-hop'],'A');result.localTrafficPassed.push('proxy-A dns='+dnsOn);
   const direct=await request(mixed,'http://localhost:'+targetPort+'/ping');assert.equal(direct.status,200);assert.equal(direct.headers['x-lab-hop'],undefined);result.localTrafficPassed.push('DIRECT dns='+dnsOn);
   if(dnsOn){const resolved=await request(mixed,'http://synthetic.test:'+targetPort+'/ping');assert.equal(resolved.status,200);assert.equal(resolved.headers['x-lab-hop'],undefined);assert.ok(dnsQueries>0);result.localTrafficPassed.push('mock-DNS enabled');}
   if(!dnsOn){
    assert.equal(dnsQueries,0,'DNS OFF must not use mock DNS');result.dnsOffQueries=dnsQueries;for(const socket of a.sockets)socket.destroy();await new Promise(r=>a.close(r));
    await until(async()=>JSON.parse((await request(controller,'/proxies/LAB',auth)).body).now==='B');const fallback=await request(mixed,raw);assert.equal(fallback.headers['x-lab-hop'],'B');result.failoverObserved=true;
    a=proxy('A');await new Promise(r=>a.listen(aPort,'127.0.0.1',r));servers.push(a);
    await until(async()=>JSON.parse((await request(controller,'/proxies/LAB',auth)).body).now==='A');assert.equal((await request(mixed,raw)).headers['x-lab-hop'],'A');result.recoveryObserved=true;
   }
   child.kill();await new Promise(resolve=>child.once('exit',resolve));
  }
  const missing={mode:'rule',tun:{enable:false},dns:{enable:false},proxies:[{name:'A',type:'http',server:'127.0.0.1',port:aPort,'dialer-proxy':'MISSING'}],rules:['MATCH,A']};const file=path.join(dir,'missing.yaml');fs.writeFileSync(file,yaml.dump(missing));const rejected=spawnSync(process.env.MIHOMO_BIN,['-t','-d',dir,'-f',file],{encoding:'utf8',timeout:15000});assert.notEqual(rejected.status,0);assert.match(rejected.stdout+rejected.stderr,/dialer-proxy.*not found/);result.missingDialer='PARSE REJECT; no traffic process started';assert.equal(rejectedExternal,0);result.dnsQueries=dnsQueries;result.nonLoopbackForwardAttempts=rejectedExternal;result.status='PASS';
 }catch(e){result.status='FAIL';result.unexpected.push(e.name+': '+String(e.message).split('\n')[0]);process.exitCode=1;}
 finally{for(const c of children)if(c.exitCode===null)c.kill();if(udp)udp.close();for(const s of servers){for(const socket of s.sockets||[])socket.destroy();s.closeAllConnections?.();try{s.close();}catch(_){}}assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));fs.rmSync(dir,{recursive:true,force:true});const dest=process.env.TEST_OUTPUT_DIR||'fieldtest-private/results/loopback';fs.mkdirSync(dest,{recursive:true});fs.writeFileSync(path.join(dest,'loopback-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));}
})().catch(e=>{console.error(e.name);process.exitCode=1;});
