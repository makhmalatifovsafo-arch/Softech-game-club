// Read-only support report. Never output raw JSON, parse-error excerpts or values.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function inspectConfig(bytes) {
  const report = {bytes:bytes.length,encoding:'UTF-8'};
  let encoding='utf-8';
  if(bytes[0]===0xff&&bytes[1]===0xfe){encoding='utf-16le';report.encoding='UTF-16 LE';}
  else if(bytes[0]===0xfe&&bytes[1]===0xff){encoding='utf-16be';report.encoding='UTF-16 BE';}
  else if(bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf)report.encoding='UTF-8 BOM';
  let text;
  try{text=new TextDecoder(encoding,{fatal:true}).decode(bytes);}
  catch{return {...report,result:'INVALID_ENCODING'};}
  report.extraLeadingBom=(text.match(/^\ufeff+/)?.[0].length)||0;
  report.nullCharacters=(text.match(/\u0000/g)||[]).length;
  report.curlyQuotes=(text.match(/[\u201c\u201d]/g)||[]).length;
  try {
    const value=JSON.parse(text);
    report.result=value&&typeof value==='object'&&!Array.isArray(value)?'VALID_OBJECT':'ROOT_NOT_OBJECT';
    report.rootType=value===null?'null':Array.isArray(value)?'array':typeof value;
    if(report.result==='VALID_OBJECT') {
      report.fields={};
      for(const key of ['cloudUrl','clubId','supabaseUrl','supabaseAnonKey','updateManifestUrl','updateIdleSeconds'])
        report.fields[key]=Object.hasOwn(value,key)?(value[key]===null?'null':typeof value[key]):'missing';
    }
  } catch(error) {
    report.result='INVALID_JSON';
    const match=error.message.match(/position (\d+)/);
    let position=match?Number(match[1]):null;
    if(position===null&&/Unexpected end/.test(error.message))position=text.length;
    if(position===null&&!/^[\s]*[\[{]/.test(text))position=text.search(/\S/);
    if(position!==null&&position>=0){
      report.position=position;
      const previous=text.slice(0,position).split('\n');
      report.line=previous.length;report.column=previous.at(-1).length+1;
    }
    report.problem=/property name/.test(error.message)?'PROPERTY_NAME_OR_TRAILING_COMMA'
      :/after property value/.test(error.message)?'MISSING_COMMA_OR_CLOSING_BRACE'
      :/after property name/.test(error.message)?'MISSING_COLON'
      :/Unterminated string/.test(error.message)?'UNCLOSED_QUOTE'
      :/Unexpected end/.test(error.message)?'INCOMPLETE_FILE':'INVALID_CHARACTER_OR_STRUCTURE';
    // Only structural punctuation outside strings is allowed in the preview.
    let quoted=false,escaped=false,shape='';
    const start=Math.max(0,(position??0)-120),end=Math.min(text.length,(position??0)+120);
    for(let i=0;i<end;i++) {
      const c=text[i];let output='*';
      if(quoted){
        if(escaped)escaped=false;
        else if(c==='\\')escaped=true;
        else if(c==='"'){quoted=false;output='"';}
      }else if(c==='"'){quoted=true;output='"';}
      else if('{}[]:, \t\r\n'.includes(c))output=c;
      if(i>=start)shape+=output;
    }
    report.maskedStructure=shape;
  }
  return report;
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  const dir=path.resolve(process.argv[2]||'C:\\SoftechServer');
  const output=path.join(path.dirname(fileURLToPath(import.meta.url)),'Softech-Config-Report.txt');
  let report;
  try{report=inspectConfig(fs.readFileSync(path.join(dir,'config.json')));}
  catch(error){report={result:'READ_FAILED',code:['ENOENT','EACCES','EPERM'].includes(error.code)?error.code:'OTHER'};}
  const content='Softech sozlamalar tekshiruvi. Asl fayl ozgartirilmadi. Maxfiy qiymatlar chiqarilmagan.\n'+
    'Runtime: '+process.version+'\n'+JSON.stringify(report,null,2)+'\n';
  console.log(content);
  try{fs.writeFileSync(output,content);console.log('Softech-Config-Report.txt faylini yordam uchun yuboring.');}
  catch{console.log('Hisobotni saqlab bolmadi. Shu oynani suratga oling.');}
}
