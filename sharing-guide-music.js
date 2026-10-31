/* Preview-only shared music transport. No analytics or account calls. */
(() => {
  'use strict';
  class LessonMusic {
    constructor(config,onError=()=>{}) {
      this.config=config;this.onError=onError;this.context=null;this.level=null;this.buffer=null;this.ready=null;
      this.source=null;this.envelope=null;this.lesson=null;this.offset=0;this.started=0;this.intent=0;
      this.wanted=false;this.muted=false;this.duck=1;this.cursors=new Map();this.starts=0;this.failed=false;
    }
    restore(values){if(values&&typeof values==='object')for(const [id,n] of Object.entries(values))if(Number.isFinite(n)&&n>=0&&n<=86400)this.cursors.set(id,n);}
    get position(){return this.source?this.offset+Math.max(0,this.context.currentTime-this.started):this.offset;}
    positions(){const out=Object.fromEntries(this.cursors);if(this.lesson)out[this.lesson]=this.position;return out;}
    select(id){if(this.lesson===id)return;this.pause();this.lesson=id;this.offset=this.cursors.get(id)||0;}
    async unlock(){
      try{
        if(!this.context){
          const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)throw Error('Audio unavailable');
          this.context=new Audio();this.level=this.context.createGain();this.level.gain.value=this.muted?0:this.duck;this.level.connect(this.context.destination);
        }
        // Called directly from a Play/Next gesture before awaiting video.play().
        const resumed=this.context.resume();
        if(!this.ready)this.ready=(async()=>{
          const r=await fetch(this.config.file);if(!r.ok)throw Error('Music unavailable');
          this.buffer=await this.context.decodeAudioData(await r.arrayBuffer());
          if(this.buffer.duration<this.config.loopEnd-.02)throw Error('Incomplete music');
          return this.buffer;
        })();
        await Promise.all([resumed,this.ready]);return true;
      }catch{
        this.wanted=false;this.pause();if(!this.failed){this.failed=true;this.onError();}return false;
      }
    }
    async play(){
      const token=++this.intent;this.wanted=true;
      if(!await this.unlock()||token!==this.intent||!this.wanted||document.hidden)return;
      if(this.source)return;
      const ctx=this.context,source=ctx.createBufferSource(),fade=ctx.createGain();
      source.buffer=this.buffer;source.loop=true;source.loopStart=this.config.loopStart;source.loopEnd=this.config.loopEnd;
      source.connect(fade);fade.connect(this.level);fade.gain.setValueAtTime(0,ctx.currentTime);fade.gain.linearRampToValueAtTime(1,ctx.currentTime+.04);
      const begin=this.config.loopStart,period=this.config.loopEnd-begin;
      const phase=this.offset<begin?this.offset:begin+(this.offset-begin)%period;
      this.source=source;this.envelope=fade;this.started=ctx.currentTime;this.starts++;
      source.onended=()=>{source.disconnect();fade.disconnect();};source.start(0,phase);
    }
    pause(){
      this.intent++;this.wanted=false;if(!this.source)return;
      const ctx=this.context,source=this.source,fade=this.envelope;this.offset=this.position;this.cursors.set(this.lesson,this.offset);
      this.source=null;this.envelope=null;
      fade.gain.cancelScheduledValues(ctx.currentTime);fade.gain.setValueAtTime(fade.gain.value,ctx.currentTime);
      fade.gain.linearRampToValueAtTime(0,ctx.currentTime+this.config.fadeSeconds);source.stop(ctx.currentTime+this.config.fadeSeconds+.01);
    }
    setMuted(muted){
      if(this.muted===muted)return;this.muted=muted;if(!this.level)return;
      const at=this.context.currentTime;this.level.gain.cancelScheduledValues(at);
      if(muted)this.level.gain.setValueAtTime(0,at);else this.level.gain.setTargetAtTime(this.duck,at,.025);
    }
    setDuck(value){
      value=Math.max(.63,Math.min(1,value));if(Math.abs(value-this.duck)<.0001)return;this.duck=value;
      if(!this.level||this.muted)return;const at=this.context.currentTime;
      this.level.gain.cancelScheduledValues(at);this.level.gain.setTargetAtTime(value,at,.025);
    }
    status(){return {lesson:this.lesson,position:this.position,playing:!!this.source,muted:this.muted,wanted:this.wanted,starts:this.starts,duck:this.duck,gain:this.level?.gain.value??0,contextState:this.context?.state??'uncreated',failed:this.failed};}
  }
  window.WanttLessonMusic=LessonMusic;
})();
