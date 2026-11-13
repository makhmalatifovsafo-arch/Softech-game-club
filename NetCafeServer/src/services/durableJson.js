import fs from 'node:fs';
import crypto from 'node:crypto';

// Persist bytes before publishing a new file; plain write+rename alone does not
// ensure the data has reached the disk when power is lost.
export function writeDurableJson(file,value) {
  const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');
  const temporary=file+'.'+crypto.randomUUID()+'.tmp';
  try {
    const fd=fs.openSync(temporary,'wx');
    try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    fs.renameSync(temporary,file);
  } finally {if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
}
