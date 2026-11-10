import test from 'node:test';import assert from 'node:assert/strict';import dgram from 'node:dgram';import {once} from 'node:events';
import {autoWakeComputer} from '../NetCafeServer/src/services/autoWake.js';import {sendWakeOnLan} from '../NetCafeServer/src/services/wolService.js';
import { normalizeMacAddress } from '../NetCafeServer/src/services/macAddress.js';
test('MAC accepts Windows physical-address format and rejects unusable wake targets', async () => {
  for (const input of ['02-AB-CD-EF-00-07', '02:ab:cd:ef:00:07', '02abcdef0007'])
    assert.equal(normalizeMacAddress(input), '02:AB:CD:EF:00:07');
  assert.equal(normalizeMacAddress(''), null);
  for (const input of ['00:00:00:00:00:00', 'FF:FF:FF:FF:FF:FF', '01:00:00:00:00:01', 'garbage02abcdef0007']) {
    assert.throws(() => normalizeMacAddress(input));
    await assert.rejects(() => sendWakeOnLan(input));
  }
});
test('auto wake uses real connectivity, reports missing MAC/errors and does not wake connected clients',async()=>{let calls=0;const pc={id:'pc',status:'AVAILABLE',mac_address:'02:00:00:00:00:07'},sendWake=async mac=>{assert.equal(mac,pc.mac_address);calls++;};assert.equal((await autoWakeComputer(pc,{isConnected:()=>false,sendWake})).status,'sent');assert.equal(calls,1);assert.equal((await autoWakeComputer({...pc,status:'OFFLINE'},{isConnected:()=>true,sendWake})).status,'online');assert.equal(calls,1);assert.equal((await autoWakeComputer({...pc,mac_address:''},{isConnected:()=>false,sendWake})).status,'missing_mac');assert.equal((await autoWakeComputer(pc,{isConnected:()=>false,sendWake:async()=>{throw Error('network');}})).status,'failed');});
test('Wake-on-LAN sends a valid 102 byte magic packet over localhost UDP',async()=>{const receiver=dgram.createSocket('udp4');receiver.bind(0,'127.0.0.1');await once(receiver,'listening');try{const packet=once(receiver,'message');await sendWakeOnLan('02:00:00:00:00:07','127.0.0.1',receiver.address().port);const [bytes]=await packet;assert.equal(bytes.length,102);assert.deepEqual([...bytes.subarray(0,6)],Array(6).fill(255));for(let i=0;i<16;i++)assert.equal(bytes.subarray(6+i*6,12+i*6).toString('hex'),'020000000007');}finally{receiver.close();}});
