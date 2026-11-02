import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const source=readFileSync(new URL('../src/views/RemoteEmulator/H264Decoder.ts',import.meta.url),'utf8');
const {default:H264Decoder}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source,{mode:"transform"})).toString('base64'));
const config=new Uint8Array([0,0,0,1,0x67,0x64,0,0x28,0,0,0,1,0x68,1]),key=new Uint8Array([0,0,0,1,0x65,1]),delta=new Uint8Array([0,0,1,0x41,1]);
test('decoder waits for IDR and resets overloaded queues',()=>{
 const decoders=[];
 globalThis.VideoDecoder=class {state='unconfigured';decodeQueueSize=0;chunks=[];constructor(cb){this.cb=cb;decoders.push(this);}configure(o){this.options=o;this.state='configured';}decode(c){this.chunks.push(c);}close(){this.state='closed';}};
 globalThis.EncodedVideoChunk=class{constructor(o){Object.assign(this,o);}};
 const d=new H264Decoder(()=>{},e=>{throw e;});d.push(config,{config:true,timestamp:0});d.push(delta,{timestamp:1});assert.equal(decoders.length,0);
 d.push(key,{timestamp:2});assert.equal(decoders[0].options.optimizeForLatency,true);assert.equal(decoders[0].chunks[0].type,'key');
 decoders[0].decodeQueueSize=4;d.push(delta,{timestamp:3});assert.equal(decoders[0].state,'closed');d.push(key,{timestamp:4});assert.equal(decoders.length,2);d.destroy();
});
