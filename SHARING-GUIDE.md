# Share Sheet setup: chaptered sharing guide

Reference: https://app.notion.com/p/409a8fe7b63481409d2dd8024c699b41

The existing `/share-sheet-setup.html` route now hosts the approved portrait
Stories-style guide: six first-save chapters (36.5 seconds) and three separate
optional Favourites chapters (20 seconds). Real reviewed Instagram/iPhone crops,
Vivian's existing narration and the approved A2 warm music are retained. Asset
hashes/provenance are in `assets/sharing-stories/asset-manifest.json`.

Right tap advances; left tap replays after one second or returns near the start.
Back/Next and keyboard controls provide alternatives. Manual playback, end holds,
caption text, still/reduced-motion viewing, background pause and paused reload
remain available. Continuous progression is an opt-in viewing option.

One shared Web Audio music transport per lesson retains its cursor across chapter
changes. Sound off silences narration, baked action cues and music together.
Pause, buffering, backgrounding and chapter-end holds pause music; late decoding
cannot revive it. Ducking follows the current chapter's actual playhead, not a
stale full-film timeline. The same approved music is locally crossfaded; no new
provider requests or credits. Cue sounds are baked into narrated chapter files,
so navigation never leaves timers that trigger stale taps.

The complete-film MP4s include music for the progressive/native-control fallback.
Chapter MP4s contain narration/cues only; do not play a mixed film beneath the
shared music again. The normal player is revealed only after successful setup;
without JavaScript, full examples and written instructions remain usable.

Only web viewing checkpoints are stored locally, under a new website-specific
key. No account/content data, analytics, provider API calls, app permissions or
OS settings are changed by watching. `wantt://saves` is the existing app route;
opening it requires a deliberate click. Existing noindex metadata, site/footer
links, help and troubleshooting are preserved. Native app/backend are unchanged.

Run `node --test tests/sharing-guide.test.cjs` and the retained admin reporting
checks. Browser verification covers the integrated page at mobile/desktop widths,
chapter controls, audio races, reduced motion, fallback/error behavior and actual
loop boundaries. Publication uses the existing website PR/Pages workflow. Browser
checks do not establish physical-iPhone/native or new-user acceptance.
