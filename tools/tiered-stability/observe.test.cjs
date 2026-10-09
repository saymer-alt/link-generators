const {test}=require('node:test'),assert=require('node:assert/strict');
const {classify,until}=require('./observe.cjs');
test('connection exceptions retain cause and original condition',async t=>{
  let clock=0;t.mock.method(Date,'now',()=>clock);
  await assert.rejects(until(async()=>{clock=20000;throw Object.assign(Error('connect refused'),{code:'ECONNREFUSED'});},'controller'),/ECONNREFUSED/);
});
test('wrong body is distinct from unavailable mixed port and dead core',()=>{
  assert(classify({failure:{sessions:[]},lastFailure:{body:'UNEXPECTED'}}).includes('UNEXPECTED_RESPONSE'));
  const tags=classify({failure:{sessions:[{exitCode:1,mixedState:{ready:false},controllerError:{},groups:{}}]}});
  assert(tags.includes('CORE_EXIT'));assert(tags.includes('CONTROLLER_NOT_READY'));assert(tags.includes('MIXED_NOT_READY'));
});
test('ROOT selection is distinct from actual traffic',()=>{
  const d={failure:{sessions:[{exitCode:null,mixedState:{ready:true},groups:{ROOT:{now:'T1'}}}]} };
  assert(classify(d).includes('T1_NO_EXPECTED_TRAFFIC'));
  d.failure.sessions[0].groups.ROOT.now='T2';assert(classify(d).includes('ROOT_NOT_T1'));
});
