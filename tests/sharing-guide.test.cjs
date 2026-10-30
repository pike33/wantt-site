const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');

// A small media boundary fake: exercise the shipped controller's user/lifecycle
// events without a browser, network, analytics, or a new test dependency.
function fixture({ reduced = false, saved = '0', storageFails = false } = {}) {
  const element = (props = {}) => {
    const listeners = new Map();
    return Object.assign({
      hidden: false, value: '0', textContent: '',
      addEventListener(name, fn) { listeners.set(name, fn); },
      emit(name, event) { return listeners.get(name)?.(event); },
    }, props);
  };
  const storage = new Map([['wantt-sharing-guide-v2:first-save', saved]]);
  const media = element({ duration: 30, currentTime: 0, paused: true, controls: true,
    play() { this.paused = false; this.emit('play'); return Promise.resolve(); },
    pause() { this.paused = true; this.emit('pause'); },
  });
  const nodes = Object.fromEntries(['.setup-still', '.setup-transport', '[data-play]', '[data-status]', 'details', '.setup-viewing', '[data-mode]', '[data-seek]', '[data-seek-label]'].map(key => [key, element()]));
  nodes.video = media;
  const root = { dataset: { lesson: 'first-save' }, querySelector: key => nodes[key] };
  const document = element({ hidden: false, querySelectorAll: () => [root] });
  const motion = element({ matches: reduced });
  const window = element({ matchMedia: () => motion });
  vm.runInNewContext(readFileSync(resolve(__dirname, '../sharing-guide.js'), 'utf8'), {
    window, document, localStorage: {
      getItem(key) { if (storageFails) throw Error('unavailable'); return storage.get(key) ?? null; },
      setItem(key, value) { if (storageFails) throw Error('unavailable'); storage.set(key, value); },
    },
  });
  return { nodes, media, document, window, motion, storage };
}

test('restores a late checkpoint paused; only deliberate play starts the example', async () => {
  const { nodes, media } = fixture({ saved: '25' });
  assert.equal(media.currentTime, 25);
  assert.equal(media.paused, true);
  assert.equal(media.controls, false);
  await nodes['[data-play]'].emit('click');
  assert.equal(media.paused, false);
  assert.equal(nodes['[data-play]'].textContent, 'Pause');
});
test('seeking uses the chosen value, pauses and retains the new checkpoint', () => {
  const { nodes, media, storage } = fixture();
  nodes['[data-seek]'].value = '27';
  nodes['[data-seek]'].emit('input');
  assert.equal(media.currentTime, 27);
  assert.equal(media.paused, true);
  assert.equal(storage.get('wantt-sharing-guide-v2:first-save'), '27');
});
test('switching apps checkpoints and returning never resumes playback automatically', async () => {
  const { nodes, media, document } = fixture();
  await nodes['[data-play]'].emit('click');
  media.currentTime = 12;
  document.hidden = true; document.emit('visibilitychange');
  assert.equal(media.paused, true);
  document.hidden = false; document.emit('visibilitychange');
  assert.equal(media.paused, true);
});
test('completion exposes Replay and never starts another lesson', async () => {
  const { nodes, media } = fixture();
  media.currentTime = 30; media.emit('ended');
  assert.equal(nodes['[data-play]'].textContent, 'Replay');
  assert.equal(nodes['[data-status]'].textContent, 'Example finished');
  await nodes['[data-play]'].emit('click');
  assert.equal(media.currentTime, 0);
});
test('reduced motion and failed video retain still/written instructions', () => {
  const { nodes, media } = fixture({ reduced: true });
  assert.equal(media.hidden, true);
  assert.equal(nodes['.setup-still'].hidden, false);
  assert.equal(nodes.details.open, true);
  media.emit('error');
  assert.equal(nodes['[data-mode]'].disabled, true);
  assert.match(nodes['[data-status]'].textContent, /written steps/);
});
test('unavailable storage and corrupt checkpoints cannot block optional help', () => {
  const noStorage = fixture({ storageFails: true });
  assert.equal(noStorage.media.currentTime, 0);
  assert.equal(noStorage.nodes['[data-play]'].disabled, false);
  assert.equal(fixture({ saved: 'Infinity' }).media.currentTime, 0);
  assert.equal(fixture({ saved: '999' }).media.currentTime, 29.98);
});
