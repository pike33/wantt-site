(() => {
  const icon = document.getElementById('wantt-app-icon');
  if (!icon) return;

  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (!finePointer.matches || reducedMotion.matches) return;

  let frame = null;
  let latestEvent = null;

  const update = () => {
    frame = null;
    if (!latestEvent) return;

    const rect = icon.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (latestEvent.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (latestEvent.clientY - rect.top) / rect.height));
    const nx = (x - 0.5) * 2;
    const ny = (y - 0.5) * 2;

    icon.style.setProperty('--rx', `${(-ny * 6.5).toFixed(2)}deg`);
    icon.style.setProperty('--ry', `${(nx * 6.5).toFixed(2)}deg`);
    icon.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
    icon.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
    icon.classList.add('is-active');
  };

  icon.addEventListener('pointermove', (event) => {
    latestEvent = event;
    if (!frame) frame = requestAnimationFrame(update);
  });

  icon.addEventListener('pointerleave', () => {
    latestEvent = null;
    if (frame) {
      cancelAnimationFrame(frame);
      frame = null;
    }
    icon.style.setProperty('--rx', '0deg');
    icon.style.setProperty('--ry', '0deg');
    icon.style.setProperty('--mx', '50%');
    icon.style.setProperty('--my', '50%');
    icon.classList.remove('is-active');
  });
})();
