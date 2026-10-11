// mixed-port Mihomo требует одновременно TCP и UDP. Проверки одного TCP мало.
const net=require('node:net'),dgram=require('node:dgram');
async function reserveMixed(port=0) {
  const udp=dgram.createSocket('udp4'),tcp=net.createServer();
  const release=async()=>{
    if(tcp.listening)await new Promise(r=>tcp.close(r));
    await new Promise(r=>{try{udp.close(r);}catch{r();}});
  };
  try {
    await new Promise((resolve,reject)=>{udp.once('error',reject);udp.bind(port,'127.0.0.1',resolve);});
    const selected=udp.address().port;
    await new Promise((resolve,reject)=>{tcp.once('error',reject);tcp.listen(selected,'127.0.0.1',resolve);});
    return {port:selected,release};
  } catch(e) { await release(); throw e; }
}
async function freeMixed(notify=()=>{},reserve=reserveMixed){
  // UDP ephemeral allocation не учитывает занятые TCP ports (и наоборот).
  // Отклоняем candidate до spawn, не повторяем core/test/traffic после failure.
  for(let attempt=1;attempt<=8;attempt++) {
    try {const reservation=await reserve();await reservation.release();return reservation.port;}
    catch(e){notify({attempt,code:e.code,port:e.port});if(!['EADDRINUSE','EACCES'].includes(e.code)||attempt===8)throw e;}
  }
}
module.exports={reserveMixed,freeMixed};
