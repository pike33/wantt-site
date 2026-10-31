(() => {
  'use strict';
  const guide=window.WANTT_GUIDE,$=(id)=>document.getElementById(id);
  const video=$('video'),picture=$('still'),player=$('player');
  const storageKey='wantt-'+guide.version;
  const music=new window.WanttLessonMusic(guide.music,()=>{$('music-warning').hidden=false;announce('Background music could not load. The spoken instructions still work.');});
  // Read-only preview diagnostics for authored transport checks.
  window.wanttMusicStatus=()=>music.status();
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  let lesson=guide.lessons[0],index=0,epoch=0,playing=false,completed=false,failed=false,still=reduced.matches,captioned=false,wantsPlay=false,hold=null;
  let pendingSeek=0,automatic=false,playRequest=0,musicSwitch=false,musicTimer=null,musicFrame=null;
  const history=new Map();
  try { const saved=JSON.parse(localStorage.getItem(storageKey)||'null');if(saved?.version===guide.version){music.restore(saved.music);const found=guide.lessons.find(l=>l.id===saved.lesson);if(found&&found.chapters.length){lesson=found;index=Math.max(0,Math.min(found.chapters.length-1,Number.isInteger(saved.index)?saved.index:0));pendingSeek=Number.isFinite(saved.time)?Math.max(0,saved.time):0;}} } catch {}
  const requested=guide.lessons.find(l=>'#'+l.id===location.hash);
  if(requested&&requested!==lesson){lesson=requested;index=0;pendingSeek=0;}
  const chapter=()=>lesson.chapters[index];
  const duration=()=>Number.isFinite(video.duration)&&video.duration>0?video.duration:chapter().duration;
  const time=()=>Number.isFinite(video.currentTime)?video.currentTime:0;
  function save(){if(!chapter())return;try{localStorage.setItem(storageKey,JSON.stringify({version:guide.version,lesson:lesson.id,index,time:video.readyState?time():pendingSeek,music:music.positions()}));}catch{}}
  function announce(text){$('announcement').textContent=text;}
  function syncMusic(){
    music.setMuted(video.muted);const c=chapter(),step=c.musicDuckStep||.05,curve=c.musicDuck||[1],at=time()/step;
    const n=Math.min(curve.length-1,Math.floor(at)),next=Math.min(curve.length-1,n+1),part=at-Math.floor(at);
    music.setDuck(curve[n]*(1-part)+curve[next]*part);
  }
  function musicTick(){musicFrame=null;syncMusic();if(playing)musicFrame=requestAnimationFrame(musicTick);}
  function stopMusic(){musicSwitch=false;clearTimeout(musicTimer);music.pause();if(musicFrame!==null)cancelAnimationFrame(musicFrame);musicFrame=null;}
  function draw(){
    if(!chapter())return;syncMusic();
    $('play').textContent=completed?'Replay':playing?'Pause':'Play';
    $('next').textContent=index===lesson.chapters.length-1?'Finish →':'Next →';
    $('back').setAttribute('aria-label',time()>1||index===0?'Restart chapter':'Previous chapter');
    $('finish').hidden=!(completed&&index===lesson.chapters.length-1);
    $('finish').textContent=lesson.id==='first-save'?'Start using Wantt':'Finish shortcut lesson';
    $('chapter-count').textContent=`${index+1} of ${lesson.chapters.length}`;
    $('chapter-title').textContent=completed&&index===lesson.chapters.length-1?'Lesson complete':chapter().title;
    // One playback control, below the picture. Never cover the real action row
    // with a second Play/Replay button or block story-edge navigation.
    $('start-overlay').hidden=true;
    $('start-label').textContent=completed?'Replay chapter':index===0?'Play lesson':'Play chapter';
    $('error-overlay').hidden=!failed;
    video.hidden=still;picture.hidden=!still;
    $('still-toggle').setAttribute('aria-pressed',String(still));
    $('caption-toggle').setAttribute('aria-pressed',String(captioned));
    $('caption').hidden=!captioned;$('caption').textContent=chapter().narration;
    $('sound').setAttribute('aria-pressed',String(!video.muted));$('sound').textContent=video.muted?'Sound off':'Sound on';
    $('auto-advance').checked=automatic;
    [...$('progress').children].forEach((segment,n)=>{segment.firstChild.style.width=(n<index?100:n===index?Math.min(100,time()/duration()*100):0)+'%';});
  }
  function pause(){playRequest++;wantsPlay=false;video.pause();playing=false;stopMusic();save();draw();}
  async function play(){
    if(still){still=false;video.hidden=false;picture.hidden=true;}
    if(failed)return;
    void music.unlock();
    if(completed){video.currentTime=0;completed=false;}
    const token=epoch,attempt=++playRequest;wantsPlay=true;
    try{await video.play();if(token!==epoch||attempt!==playRequest)return;if(!wantsPlay||document.hidden){pause();return;}playing=true;musicSwitch=false;clearTimeout(musicTimer);void music.play();if(musicFrame===null)musicFrame=requestAnimationFrame(musicTick);draw();}
    catch{if(token===epoch&&attempt===playRequest&&wantsPlay){playing=false;wantsPlay=false;stopMusic();draw();announce('Press Play to start this chapter.');}}
  }
  function load(next,autoplay=false,seek=0){
    const keep=autoplay&&!still&&music.status().playing&&music.lesson===lesson.id;
    music.select(lesson.id);musicSwitch=keep;clearTimeout(musicTimer);
    if(keep)musicTimer=setTimeout(()=>{if(musicSwitch){musicSwitch=false;music.pause();}},500);else music.pause();
    playRequest++;video.pause();wantsPlay=false;playing=false;epoch++;index=Math.max(0,Math.min(lesson.chapters.length-1,next));completed=false;failed=false;pendingSeek=Math.max(0,Math.min(chapter().duration-.05,seek));$('finished').hidden=true;
    video.src=chapter().file;video.poster=chapter().poster;picture.src=chapter().poster;picture.alt=chapter().title+' — recorded example';
    video.setAttribute('aria-label',chapter().title);video.load();
    $('progress').replaceChildren(...lesson.chapters.map(()=>{const d=document.createElement('div');d.className='segment';d.append(document.createElement('span'));return d;}));
    $('steps').replaceChildren(...chapter().steps.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
    guide.lessons.forEach(l=>$(l.id).setAttribute('aria-pressed',String(l===lesson)));
    announce(`${lesson.title}. Chapter ${index+1} of ${lesson.chapters.length}. ${chapter().title}`);draw();save();
    if(autoplay&&!still)void play();
  }
  function next(){if(index<lesson.chapters.length-1){load(index+1,!still);}else{pause();completed=true;pendingSeek=duration();if(video.readyState>=1)video.currentTime=duration();draw();save();announce('Lesson complete. Replay any chapter, or try the optional shortcut.');}}
  function back(){if(time()>1||index===0){video.currentTime=0;completed=false;pendingSeek=0;if(!still)void play();draw();save();}else load(index-1,!still);}
  $('next').addEventListener('click',next);$('back').addEventListener('click',back);
  $('play').addEventListener('click',()=>playing?pause():void play());$('start-overlay').addEventListener('click',()=>void play());
  $('sound').addEventListener('click',()=>{video.muted=!video.muted;music.setMuted(video.muted);draw();});
  $('caption-toggle').addEventListener('click',()=>{captioned=!captioned;draw();});
  $('still-toggle').addEventListener('click',()=>{pause();still=!still;draw();});
  $('retry').addEventListener('click',()=>{load(index,false,time());});
  $('auto-advance').addEventListener('change',e=>{automatic=e.target.checked;});
  $('finish').addEventListener('click',()=>{pause();$('finished').hidden=false;$('finished').focus();});
  $('restart-lesson').addEventListener('click',()=>{load(0,false);$('play').focus();});
  for(const id of ['previous-zone','next-zone']){
    const zone=$(id);zone.addEventListener('click',e=>e.preventDefault());
    zone.addEventListener('pointerdown',e=>{if(e.button!==0)return;hold={x:e.clientX,y:e.clientY,start:performance.now(),wasPlaying:playing||wantsPlay||!video.paused,pointer:e.pointerId,id};zone.setPointerCapture(e.pointerId);if(hold.wasPlaying)pause();});
    zone.addEventListener('pointerup',e=>{const h=hold;hold=null;if(!h||h.pointer!==e.pointerId)return;const moved=Math.hypot(e.clientX-h.x,e.clientY-h.y)>18,elapsed=performance.now()-h.start;if(moved)return;if(elapsed>350){if(h.wasPlaying)void play();return;}if(id==='next-zone')next();else back();});
    zone.addEventListener('pointermove',e=>{if(hold&&Math.hypot(e.clientX-hold.x,e.clientY-hold.y)>18){hold=null;pause();}});
    zone.addEventListener('pointercancel',()=>{hold=null;pause();});
  }
  // Holding the picture pauses immediately. A short release navigates; a long
  // release resumes only the chapter that was already playing.
  document.addEventListener('keydown',e=>{if(e.target.closest('input,summary,a,textarea,select'))return;const button=e.target.closest('button');if(e.key==='ArrowRight'||e.key==='ArrowLeft'){if(button&&!button.closest('.controls,#player'))return;e.preventDefault();e.key==='ArrowRight'?next():back();}else if(e.code==='Space'&&!button){e.preventDefault();playing?pause():void play();}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});window.addEventListener('pagehide',pause);
  reduced.addEventListener('change',e=>{if(e.matches){pause();still=true;automatic=false;draw();announce('Reduced motion enabled. Still view selected.');}});
  function chooseLesson(l,writeHash=true){if(l===lesson)return;history.set(lesson.id,{index,time:time()});pause();lesson=l;const s=history.get(l.id);load(s?.index??0,false,s?.time??0);if(writeHash)window.history.replaceState(null,'','#'+l.id);}
  guide.lessons.forEach(l=>$(l.id).addEventListener('click',()=>chooseLesson(l)));
  window.addEventListener('hashchange',()=>{const l=guide.lessons.find(item=>'#'+item.id===location.hash);if(l)chooseLesson(l,false);});
  video.addEventListener('loadedmetadata',()=>{const start=completed?duration():Math.max(0,Math.min(duration()-.05,pendingSeek));pendingSeek=0;video.currentTime=start;if(start>=duration()-.08)completed=true;draw();save();});
  video.addEventListener('play',()=>{if(!wantsPlay||document.hidden){video.pause();return;}playing=true;draw();});video.addEventListener('pause',()=>{playing=false;if(!musicSwitch&&!(video.ended&&automatic&&!still&&index<lesson.chapters.length-1)&&video.paused)stopMusic();save();draw();});
  video.addEventListener('timeupdate',()=>{draw();});
  video.addEventListener('waiting',()=>{if(wantsPlay&&!musicSwitch)music.pause();});
  video.addEventListener('stalled',()=>{if(wantsPlay&&!musicSwitch)music.pause();});
  video.addEventListener('playing',()=>{if(wantsPlay&&!document.hidden){void music.play();if(musicFrame===null)musicFrame=requestAnimationFrame(musicTick);}});
  video.addEventListener('ended',()=>{if(video.readyState<1||time()<duration()-.08)return;playing=false;wantsPlay=false;completed=true;save();if(automatic&&!still&&index<lesson.chapters.length-1)load(index+1,true);else{stopMusic();draw();announce(index===lesson.chapters.length-1?'Lesson complete.':'Chapter complete. Choose Next when you are ready.');}});
  video.addEventListener('error',()=>{pause();failed=true;$('instructions').open=true;draw();announce('Video unavailable. Written instructions are available below.');});
  $('shortcut').disabled=!guide.lessons[1].chapters.length;
  load(index,false,pendingSeek);
  $('sharing-lessons').hidden=false;$('plain-guide').hidden=true;
})();
