const {test}=require('node:test'),assert=require('node:assert/strict'),net=require('node:net'),dgram=require('node:dgram');
const {reserveMixed,freeMixed}=require('./ports.cjs');
const bindUdp=(socket,port=0)=>new Promise((r,j)=>{socket.once('error',j);socket.bind(port,'127.0.0.1',r);});
test('TCP-only allocation can accept a port occupied in UDP; dual reservation rejects it',async()=>{
 const udp=dgram.createSocket('udp4');await bindUdp(udp);const port=udp.address().port,tcp=net.createServer();
 try {await new Promise((r,j)=>{tcp.once('error',j);tcp.listen(port,'127.0.0.1',r);});await new Promise(r=>tcp.close(r));await assert.rejects(reserveMixed(port),{code:'EADDRINUSE'});}
 finally {if(tcp.listening)await new Promise(r=>tcp.close(r));await new Promise(r=>udp.close(r));}
});
test('dual reservation owns and releases both protocols',async()=>{
 const first=await reserveMixed();try{await assert.rejects(reserveMixed(first.port),{code:'EADDRINUSE'});}finally{await first.release();}
 const second=await reserveMixed(first.port);await second.release();
});
test('candidate conflicts are bounded and reported before any core startup',async()=>{
 let attempts=0,released=false;const events=[];
 const port=await freeMixed(e=>events.push(e),async()=>{if(++attempts===1)throw Object.assign(Error('occupied TCP candidate'),{code:'EADDRINUSE',port:12345});return{port:23456,release:async()=>{released=true;}};});
 assert.equal(port,23456);assert.equal(attempts,2);assert(released);assert.equal(events[0].code,'EADDRINUSE');
 attempts=0;await assert.rejects(freeMixed(()=>{},async()=>{attempts++;throw Object.assign(Error('forbidden candidate'),{code:'EACCES'});}),{code:'EACCES'});assert.equal(attempts,8);
});
