const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
for(const file of ['server.js','features.js',...fs.readdirSync(path.join(__dirname,'public')).filter(x=>/\.(html|js)$/.test(x)).map(x=>'public/'+x)]){
  const source=fs.readFileSync(path.join(__dirname,file),'utf8');
  if(file.endsWith('.js'))new vm.Script(source,{filename:file});
  else for(const [i,match]of [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].entries())new vm.Script(match[1],{filename:file+':script'+i});
}
console.log('PASS: server, browser scripts and inline HTML scripts parse.');
