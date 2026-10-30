# Release 0.11.0 E sharing help

Story: https://app.notion.com/p/407a8fe7b63481b2958ee9e1b71d90f7
Reference: https://app.notion.com/p/409a8fe7b63481409d2dd8024c699b41

The complete first-save/return and optional shortcut use the same reviewed
1080 × 1920, silent 30/21-second exports as the native app. Asset hashes and
probes are in `assets/first-use/asset-manifest.json`. Original recordings and
personal recipient/friend-liker regions are excluded. Optional customisation
shows both checkmarks. The first-save lesson is sufficient without Favourites.

No autoplay or auto-advance. The enhanced player has one Play/Pause/Replay
control and one disclosure for full text, motion/still and seeking. Switching
tabs/apps pauses. Only lesson playheads are saved locally under a v2 key;
no account/content data, network measurement or analytics is added. Reduce
Motion selects still/text; choosing Motion starts paused. Errors expose the
written alternative. Without JavaScript, native controls and open text remain.
Web checkpoints reset independently of app/OS settings and never verify setup.

Run `node --test tests/sharing-guide.test.cjs` and
`node --test admin/tests/reporting.test.cjs`. Also review at 320/390 px, with
Reduce Motion and JavaScript disabled, and test late seeking, background pause,
paused reload and end/Replay. Browser checks do not replace native iPhone or
uncoached newcomer acceptance. Publication follows the normal site PR workflow.
