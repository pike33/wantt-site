/* Local, optional lesson checkpoints only. No analytics, saved links or account data. */
(() => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const lessons = [];
  document.querySelectorAll('[data-lesson]').forEach((root) => {
    const video = root.querySelector('video');
    const still = root.querySelector('.setup-still');
    const transport = root.querySelector('.setup-transport');
    const play = root.querySelector('[data-play]');
    const status = root.querySelector('[data-status]');
    const options = root.querySelector('details');
    const viewing = root.querySelector('.setup-viewing');
    const mode = root.querySelector('[data-mode]');
    const seek = root.querySelector('[data-seek]');
    const seekLabel = root.querySelector('[data-seek-label]');
    const key = `wantt-sharing-guide-v2:${root.dataset.lesson}`;
    let failed = false;
    let restored = false;
    const end = () => video.duration > 0 && video.currentTime >= video.duration - 0.08;
    const checkpoint = () => {
      // Still-mode selection and early background events can precede metadata.
      // Do not replace the saved playhead with the player’s initial zero.
      if (!restored || failed) return;
      try { localStorage.setItem(key, String(video.currentTime)); } catch { /* optional */ }
    };
    const update = () => {
      play.textContent = video.paused ? (end() ? 'Replay' : 'Play') : 'Pause';
      status.textContent = failed ? 'Video unavailable · follow the written steps' : end() ? 'Example finished' : video.paused ? 'Example · paused' : 'Example · playing';
      seek.value = String(video.currentTime);
    };
    const pause = () => { video.pause(); checkpoint(); update(); };
    const view = (asStill) => {
      pause();
      video.hidden = asStill;
      still.hidden = !asStill;
      play.hidden = asStill;
      seekLabel.hidden = asStill;
      mode.value = asStill ? 'still' : 'motion';
    };
    const restore = () => {
      if (restored || !Number.isFinite(video.duration) || video.duration <= 0) return;
      restored = true;
      let saved = 0;
      try { saved = Number(localStorage.getItem(key)); } catch { /* optional */ }
      video.currentTime = Number.isFinite(saved) ? Math.max(0, Math.min(saved, video.duration - 0.02)) : 0;
      seek.max = String(video.duration - 0.02);
      play.disabled = false;
      update();
    };
    play.addEventListener('click', async () => {
      if (!video.paused) return pause();
      lessons.forEach((lesson) => lesson.pause());
      if (end()) video.currentTime = 0;
      try { await video.play(); } catch { status.textContent = 'Unable to play · try again or use the written steps'; }
    });
    mode.addEventListener('change', () => view(mode.value === 'still'));
    seek.addEventListener('input', () => {
      const target = Number(seek.value);
      pause(); video.currentTime = target; checkpoint(); update();
    });
    video.addEventListener('loadedmetadata', restore);
    video.addEventListener('timeupdate', () => { seek.value = String(video.currentTime); });
    video.addEventListener('pause', () => { checkpoint(); update(); });
    video.addEventListener('play', update);
    video.addEventListener('ended', () => { pause(); });
    video.addEventListener('error', () => {
      failed = true; options.open = true; view(true); mode.disabled = true;
    });
    lessons.push({ pause, still: () => { options.open = true; view(true); } });
    video.controls = false;
    play.disabled = true;
    transport.hidden = false;
    viewing.hidden = false;
    options.open = reduced.matches;
    if (reduced.matches) view(true);
    restore();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) lessons.forEach((lesson) => lesson.pause());
  });
  window.addEventListener('pagehide', () => lessons.forEach((lesson) => lesson.pause()));
  reduced.addEventListener('change', (event) => {
    if (event.matches) lessons.forEach((lesson) => lesson.still());
  });
})();
