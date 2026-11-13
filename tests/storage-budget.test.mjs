import test from 'node:test';
import assert from 'node:assert/strict';
import {requireStorageSpace,STORAGE_RESERVE_BYTES} from '../NetCafeServer/src/services/storageBudget.js';

test('optional disk copies leave a reserve and use available blocks with bigint precision',()=>{
  const disk=bytes=>()=>({bavail:BigInt(bytes),bsize:1n});
  assert.throws(()=>requireStorageSpace('.',4096,disk(STORAGE_RESERVE_BYTES+4095)),{code:'ENOSPC'});
  assert.doesNotThrow(()=>requireStorageSpace('.',4096,disk(STORAGE_RESERVE_BYTES+4096)));
  assert.doesNotThrow(()=>requireStorageSpace('.',4096,()=>({bavail:2n**60n,bsize:4096n})));
  for(const bytes of [-1,NaN,Infinity,1.1])assert.throws(()=>requireStorageSpace('.',bytes,disk(2**40)));
});
