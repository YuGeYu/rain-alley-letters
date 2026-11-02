const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {createToolLauncher}=require('../src/tool-launcher.cjs');
test('tool launch rejects concurrent requests and Explorer processes, releases on exit/error',async()=>{
 let processes=[],starts=0,child;
 const launcher=createToolLauncher({list:()=>processes,start:()=>{starts++;child=new EventEmitter();child.unref=()=>{};return child;}});
 const open=()=>launcher.launch('panel','C:/game/Panel v1.4.7.exe',/^Panel v1\..*\.exe$/i,'Panel');
 const first=open();await assert.rejects(open(),/正在启动或运行/);assert.equal(starts,1);
 child.emit('spawn');await first;await assert.rejects(open(),/正在启动或运行/);
 child.emit('exit',0);processes=['Panel v1.4.7.exe'];await assert.rejects(open(),/已经运行/);assert.equal(starts,1);
 processes=[];const fail=open();child.emit('error',new Error('denied'));await assert.rejects(fail,/无法启动/);
 const retry=open();child.emit('spawn');await retry;assert.equal(starts,3);child.emit('exit',0);
});
test('game launch shares a cooldown, permits retry after expiry, rejects running game and unlocks failed requests',async()=>{
 let clock=100,processes=[],calls=0;const launcher=createToolLauncher({list:()=>processes,now:()=>clock});
 const open=()=>launcher.launchGame(async()=>{calls++;},'steam://run/730');
 await open();await assert.rejects(open(),/正在启动/);assert.equal(calls,1);
 clock+=15001;processes=['cs2.exe'];await assert.rejects(open(),/已经运行/);assert.equal(calls,1);
 processes=[];await assert.rejects(launcher.launchGame(async()=>{throw Error('Steam unavailable');},'steam://run/730'),/Steam unavailable/);
 await open();assert.equal(calls,2);
});
test('process enumeration failure stops launching safely and permits a later retry',async()=>{
 let broken=true,started=0;const launcher=createToolLauncher({list:()=>{if(broken)throw Error('状态检查失败');return [];},start:()=>{started++;const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>child.emit('spawn'));return child;}});
 await assert.rejects(launcher.launch('demo','C:/demo.exe',/^demo.exe$/i,'DemoTracer'),/状态检查失败/);assert.equal(started,0);
 broken=false;await launcher.launch('demo','C:/demo.exe',/^demo.exe$/i,'DemoTracer');assert.equal(started,1);
});
