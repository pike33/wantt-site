(() => {
  'use strict';
  const guide = window.WANTT_GUIDE;
  const $ = id => document.getElementById(id);
  const video = $('video');
  const picture = $('still');
  const player = $('player');
  const playButton = $('play');
  const nextButton = $('next');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const storageKey = 'wantt-' + guide.version;
  const positions = new Map();
  const bound = (value, max) => Number.isFinite(value) ? Math.min(max, Math.max(0, value)) : 0;
  let lesson = guide.lessons[0], position = 0, index = -1;
  let ready = false, completed = false, failed = false, still = reduced.matches, captioned = false;
  let wantsPlay = false, attempt = 0, hold;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (saved) {
      for (const item of guide.lessons) positions.set(item.id, bound(saved.positions?.[item.id], item.duration));
      lesson = guide.lessons.find(item => item.id === saved.lesson) || lesson;
    } else {
      const old = JSON.parse(localStorage.getItem('wantt-web-sharing-stories-v1') || 'null');
      const previous = guide.lessons.find(item => item.id === old?.lesson);
      const chapter = previous?.chapters[old?.index];
      if (old?.version === 'web-sharing-stories-v1' && chapter) {
        lesson = previous;
        positions.set(previous.id, chapter.start + bound(old.time, chapter.duration));
      }
    }
  } catch {}
  lesson = guide.lessons.find(item => '#' + item.id === location.hash) || lesson;

  function save() {
    positions.set(lesson.id, position);
    try {
      localStorage.setItem(storageKey, JSON.stringify({lesson: lesson.id, positions: Object.fromEntries(positions)}));
    } catch {}
  }

  function announce(text) {
    $('announcement').textContent = text;
  }

  function draw() {
    const next = lesson.chapters.findIndex(chapter => chapter.start > position);
    const current = next < 0 ? lesson.chapters.length - 1 : next - 1;
    const chapter = lesson.chapters[current];
    if (current !== index) {
      index = current;
      picture.src = chapter.poster;
      picture.alt = chapter.title + ' — recorded example';
      $('steps').replaceChildren(...chapter.steps.map(text => {
        const step = document.createElement('li');
        step.textContent = text;
        return step;
      }));
      announce(`${lesson.title}. Chapter ${index + 1} of ${lesson.chapters.length}. ${chapter.title}`);
    }
    $('chapter-count').textContent = `${index + 1} of ${lesson.chapters.length}`;
    $('chapter-title').textContent = completed ? 'Lesson complete' : chapter.title;
    playButton.textContent = completed ? 'Replay' : wantsPlay ? 'Pause' : 'Play';
    playButton.disabled = failed;
    // Keep the one Play control visible even when the portrait picture is taller than the phone.
    const onPicture = !wantsPlay && !still && !failed;
    const controls = onPicture ? player : nextButton.parentElement;
    if (playButton.parentElement !== controls) {
      const focused = document.activeElement === playButton;
      controls.insertBefore(playButton, onPicture ? null : nextButton);
      if (focused) playButton.focus({preventScroll: true});
    }
    $('back').setAttribute('aria-label', index ? 'Previous chapter' : 'Restart first chapter');
    $('next').textContent = next < 0 ? 'Finish →' : 'Next →';
    $('finish').hidden = !completed;
    $('finish').textContent = lesson.id === 'first-save' ? 'Start using Wantt' : 'Finish shortcut lesson';
    $('error-overlay').hidden = !failed;
    video.hidden = still;
    picture.hidden = !still;
    $('still-toggle').setAttribute('aria-pressed', String(still));
    $('caption-toggle').setAttribute('aria-pressed', String(captioned));
    $('caption').hidden = !captioned;
    $('caption').textContent = chapter.narration;
    $('sound').setAttribute('aria-pressed', String(!video.muted));
    $('sound').textContent = video.muted ? 'Sound off' : 'Sound on';
    [...$('progress').children].forEach((segment, i) => {
      const marker = lesson.chapters[i];
      segment.firstChild.style.width = bound((position - marker.start) / marker.duration * 100, 100) + '%';
    });
  }

  function readPosition() {
    if (ready && !completed && video.readyState >= 1) position = bound(video.currentTime, lesson.duration);
  }

  function pause() {
    wantsPlay = false;
    attempt++;
    video.pause();
    readPosition();
    save();
    draw();
  }

  function seek(seconds) {
    position = bound(seconds, lesson.duration);
    completed = false;
    $('finished').hidden = true;
    if (ready) video.currentTime = Math.min(position, lesson.duration - .02);
    save();
    draw();
  }

  async function play() {
    if (failed || document.hidden) return;
    if (still) still = false;
    if (completed) seek(0);
    wantsPlay = true;
    const token = ++attempt;
    draw();
    try {
      await video.play();
    } catch {
      if (token !== attempt) return;
      wantsPlay = false;
      draw();
      announce('Press Play to start the lesson.');
    }
  }

  function load(item, seconds) {
    wantsPlay = false;
    attempt++;
    ready = false;
    video.pause();
    lesson = item;
    position = bound(seconds, lesson.duration);
    completed = position >= lesson.duration - .02;
    failed = false;
    index = -1;
    $('finished').hidden = true;
    video.src = lesson.file;
    video.poster = lesson.chapters[0].poster;
    video.setAttribute('aria-label', lesson.title + ' — recorded example');
    video.load();
    $('progress').replaceChildren(...lesson.chapters.map(() => {
      const segment = document.createElement('div');
      segment.className = 'segment';
      segment.append(document.createElement('span'));
      return segment;
    }));
    guide.lessons.forEach(item => $(item.id).setAttribute('aria-pressed', String(item === lesson)));
    draw();
  }

  function finishLesson(skip) {
    pause();
    completed = true;
    position = lesson.duration;
    if (skip && ready) video.currentTime = Math.max(0, lesson.duration - .02);
    save();
    draw();
    announce('Lesson complete. You can replay or continue.');
  }

  function move(direction) {
    if (direction > 0 && index === lesson.chapters.length - 1) finishLesson(true);
    else seek(lesson.chapters[Math.max(0, index + direction)].start);
  }

  function chooseLesson(item, writeHash = true) {
    if (item === lesson) return;
    pause();
    load(item, positions.get(item.id) || 0);
    if (writeHash) window.history.replaceState(null, '', '#' + item.id);
  }

  $('next').addEventListener('click', () => move(1));
  $('back').addEventListener('click', () => move(-1));
  $('play').addEventListener('click', () => wantsPlay ? pause() : void play());
  $('sound').addEventListener('click', () => { video.muted = !video.muted; draw(); });
  $('caption-toggle').addEventListener('click', () => { captioned = !captioned; draw(); });
  $('still-toggle').addEventListener('click', () => { pause(); still = !still; draw(); });
  $('retry').addEventListener('click', () => load(lesson, position));
  $('finish').addEventListener('click', () => {
    pause();
    $('finished').hidden = false;
    $('finished').focus();
  });
  $('restart-lesson').addEventListener('click', () => {
    seek(0);
    $('play').focus();
  });

  for (const [id, direction] of [['previous-zone', -1], ['next-zone', 1]]) {
    const zone = $(id);
    zone.addEventListener('click', e => e.preventDefault());
    zone.addEventListener('pointerdown', e => {
      if (e.button !== 0 || hold || failed) return;
      const gesture = {id: e.pointerId, x: e.clientX, y: e.clientY, wasPlaying: wantsPlay, held: false};
      hold = gesture;
      zone.setPointerCapture(e.pointerId);
      gesture.timer = setTimeout(() => {
        gesture.held = true;
        if (gesture.wasPlaying) pause();
      }, 350);
    });
    const cancelHold = e => {
      if (!hold || hold.id !== e.pointerId) return;
      clearTimeout(hold.timer);
      hold = null;
    };
    zone.addEventListener('pointerup', e => {
      const gesture = hold;
      if (!gesture || gesture.id !== e.pointerId) return;
      cancelHold(e);
      if (gesture.held) {
        if (gesture.wasPlaying) void play();
      } else move(direction);
    });
    zone.addEventListener('pointermove', e => {
      if (hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 18) cancelHold(e);
    });
    zone.addEventListener('pointercancel', cancelHold);
    zone.addEventListener('lostpointercapture', cancelHold);
  }

  document.addEventListener('keydown', e => {
    if (e.target.closest('input,summary,a,textarea,select')) return;
    const button = e.target.closest('button');
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      if (button && !button.closest('.controls,#player')) return;
      e.preventDefault();
      move(e.key === 'ArrowRight' ? 1 : -1);
    } else if (e.code === 'Space' && !button) {
      e.preventDefault();
      wantsPlay ? pause() : void play();
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('pagehide', pause);
  reduced.addEventListener('change', e => {
    if (!e.matches) return;
    pause();
    still = true;
    draw();
    announce('Reduced motion enabled. Still view selected.');
  });
  guide.lessons.forEach(item => $(item.id).addEventListener('click', () => chooseLesson(item)));
  window.addEventListener('hashchange', () => {
    const item = guide.lessons.find(item => '#' + item.id === location.hash);
    if (item) chooseLesson(item, false);
  });
  video.addEventListener('loadedmetadata', () => {
    ready = true;
    video.currentTime = Math.min(position, Math.max(0, video.duration - .02));
    draw();
  });
  video.addEventListener('play', () => {
    if (!wantsPlay || document.hidden) video.pause();
  });
  video.addEventListener('pause', () => {
    if (ready && wantsPlay && video.paused && !video.ended) pause();
  });
  video.addEventListener('timeupdate', () => { readPosition(); draw(); });
  video.addEventListener('ended', () => { if (ready && video.ended) finishLesson(false); });
  video.addEventListener('error', () => {
    pause();
    failed = true;
    $('instructions').open = true;
    draw();
    announce('Video unavailable. Written instructions are available below.');
  });

  load(lesson, positions.get(lesson.id) || 0);
  $('sharing-lessons').hidden = false;
  $('plain-guide').hidden = true;
})();
