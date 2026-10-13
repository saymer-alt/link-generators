// Research only. ACORN_PATH points at an external acorn@8.15.0 installation.
const fs=require('node:fs');
const acorn=require(process.env.ACORN_PATH||'acorn');
const cp=require('node:child_process');
const rows=[];
const lexical={};
const ru=/[А-Яа-яЁё]/;
for(const file of ['index.html','quick-start.html']){
 const src=fs.readFileSync(file,'utf8');
 lexical[file]={lines:src.split('\n').length,bytes:Buffer.byteLength(src),JSstrings:0,JStemplateChunks:0};
 const line=offset=>src.slice(0,offset).split('\n').length;
 const add=(kind,offset,text)=>{if(ru.test(text))rows.push({file,line:line(offset),kind,text:text.trim()});};
 let html=src.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,m=>m.replace(/[^\n]/g,' ')).replace(/<!--[\s\S]*?-->/g,m=>m.replace(/[^\n]/g,' '));
 for(const m of html.matchAll(/>([^<>]+)</g))add('HTML text',m.index+1,m[1]);
 for(const m of html.matchAll(/\b(aria-label|aria-description|title|placeholder|alt)\s*=\s*(["'])(.*?)\2/g))add('attribute:'+m[1],m.index,m[3]);
 for(const m of src.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)){
  const offset=m.index+m[0].indexOf('>')+1;
  for(const t of acorn.tokenizer(m[1],{ecmaVersion:'latest'})){
   if(t.type.label==='string')lexical[file].JSstrings++;
   if(t.type.label==='template')lexical[file].JStemplateChunks++;
   if(t.type.label==='string'||t.type.label==='template')add('JS '+t.type.label,offset+t.start,String(t.value||''));
  }
 }
}
const counts={};for(const r of rows){const key=r.file+': '+r.kind;counts[key]=(counts[key]||0)+1;}
const summary={source:cp.execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),method:'Cyrillic-bearing HTML text nodes/attributes and Acorn string/template tokens, comments excluded; candidates, not translation keys',lexical,counts,total:rows.length,uniqueText:new Set(rows.map(r=>r.text)).size};
fs.writeFileSync('docs/research/I18N-INVENTORY.json',JSON.stringify({summary,rows},null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
