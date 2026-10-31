const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const vm=require('node:vm');

// Exercise the public music transport's lifecycle boundaries, not media synthesis.
function fixture({delayed=false,broken=false}={}){
 const contexts=[];let release;
 const decoded=delayed?new Promise(r=>{release=r;}):Promise.resolve({duration:14});
 class Audio{
  constructor(){this.currentTime=0;this.state='suspended';this.destination={};this.sources=[];contexts.push(this);}
  resume(){this.state='running';return Promise.resolve();}
  createGain(){return{connect(){},disconnect(){},gain:{value:1,cancelScheduledValues(){},setValueAtTime(v){this.value=v;},setTargetAtTime(v){this.value=v;},linearRampToValueAtTime(v){this.value=v;}}};}
  decodeAudioData(){return decoded;}
  createBufferSource(){const s={connect(){},disconnect(){},start(at,offset){this.offset=offset;this.started=true;},stop(){this.stopped=true;}};this.sources.push(s);return s;}
 }
 const document={hidden:false},window={AudioContext:Audio};let errors=0;
 vm.runInNewContext(readFileSync(resolve(__dirname,'../sharing-guide-music.js'),'utf8'),{window,document,Map,Object,Number,Math,fetch:async()=>({ok:!broken,arrayBuffer:async()=>new ArrayBuffer(2)})});
 const music=new window.WanttLessonMusic({file:'approved.wav',loopStart:2,loopEnd:14,fadeSeconds:.06},()=>errors++);music.select('first-save');
 return{music,contexts,document,release:()=>release?.({duration:14}),errors:()=>errors};
}

test('constructing, selecting or muting never starts audio',()=>{const f=fixture();f.music.setMuted(true);f.music.select('shortcut');assert.equal(f.contexts.length,0);assert.equal(f.music.status().playing,false);});
test('a late decode cannot start music after Pause',async()=>{const f=fixture({delayed:true});const p=f.music.play();f.music.pause();f.release();await p;assert.equal(f.contexts[0].sources.length,0);assert.equal(f.music.status().wanted,false);});
test('resume keeps the cursor and wraps beyond the intro into the loop',async()=>{const f=fixture();await f.music.play();f.contexts[0].currentTime=35;f.music.pause();assert.equal(f.music.position,35);await f.music.play();assert.equal(f.contexts[0].sources[1].offset,11);assert.equal(f.contexts[0].sources[1].loopStart,2);assert.equal(f.contexts[0].sources[1].loopEnd,14);});
test('replaying within a lesson does not recreate an active source',async()=>{const f=fixture();await f.music.play();f.contexts[0].currentTime=4;await f.music.play();assert.equal(f.contexts[0].sources.length,1);assert.equal(f.music.position,4);});
test('lesson changes pause and preserve independent positions',async()=>{const f=fixture();await f.music.play();f.contexts[0].currentTime=3;f.music.select('shortcut');assert.equal(f.music.position,0);assert.equal(f.music.status().playing,false);await f.music.play();f.contexts[0].currentTime=5;f.music.select('first-save');assert.equal(f.music.position,3);assert.equal(f.music.status().playing,false);f.music.select('shortcut');assert.equal(f.music.position,2);});
test('mute silences the background gain and unmute never starts a paused source',async()=>{const f=fixture();await f.music.play();f.music.setMuted(true);assert.equal(f.music.status().gain,0);f.music.pause();f.music.setMuted(false);assert.equal(f.music.status().playing,false);assert.ok(f.music.status().gain>0);});
test('ducking is bounded and cannot override Sound off',async()=>{const f=fixture();await f.music.play();f.music.setDuck(.1);assert.equal(f.music.status().duck,.63);f.music.setMuted(true);f.music.setDuck(10);assert.equal(f.music.status().gain,0);f.music.setMuted(false);assert.equal(f.music.status().gain,1);});
test('unavailable optional music reports once and never starts a source',async()=>{const f=fixture({broken:true});await f.music.play();await f.music.play();assert.equal(f.errors(),1);assert.equal(f.music.status().playing,false);assert.equal(f.contexts[0].sources.length,0);});
test('hidden-page playback intent cannot start music',async()=>{const f=fixture();f.document.hidden=true;await f.music.play();assert.equal(f.contexts[0].sources.length,0);f.document.hidden=false;await f.music.play();assert.equal(f.contexts[0].sources.length,1);});
test('restoring invalid cursor data cannot create audio or poison a later loop',()=>{const f=fixture();f.music.restore({shortcut:5,invalid:Infinity,negative:-1,text:'3'});f.music.select('shortcut');assert.equal(f.music.position,5);f.music.select('invalid');assert.equal(f.music.position,0);assert.equal(f.contexts.length,0);});
