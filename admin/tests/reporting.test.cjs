// No network or packages required: exercise the shipped script with controlled DOM/API ports.
// Run: node --test admin/tests/reporting.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const script = fs.readFileSync(path.join(__dirname, '../admin.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const flush = async () => { for (let i = 0; i < 20; i++) await new Promise(setImmediate); };
class Element {
  constructor(id = '') { this.id = id; this.hidden = false; this.value = ''; this.textContent = ''; this.innerHTML = ''; this.dataset = {}; this.events = {}; this.attributes = {}; this.disabled = false; this.classList = { add() {}, remove() {}, toggle() {} }; }
  addEventListener(type, fn) { (this.events[type] ||= []).push(fn); }
  emit(type, event = {}) { return Promise.all((this.events[type] || []).map(fn => fn({ preventDefault() {}, ...event }))); }
  setAttribute(name, value) { this.attributes[name] = value; }
  querySelector() { return this.child ||= new Element(); }
  querySelectorAll(selector) {
    if (selector !== '[data-capture-id]') return [];
    this.buttons = [...this.innerHTML.matchAll(/data-capture-id="([^"]+)"/g)].map(m => { const button = new Element(); button.dataset.captureId = m[1]; return button; });
    return this.buttons;
  }
  focus() { this.focused = true; }
}
const row = (id, overrides = {}) => ({ captureId: id, status: 'enriched', createdAt: '2026-09-14T00:00:00.123456Z', updatedAt: '2026-10-04T04:00:00Z', retryCycle: 1, attemptCount: 2, failedAttemptCount: 1,
  source: { platform: 'instagram', postingAccount: { username: 'creator' }, ambiguous: false },
  currentPlace: { id: 'canonical', name: 'Current Place', authority: 'manual', scope: 'current_inactive_save' }, extractionCandidate: 'Old candidate', retainedDecision: { reason: 'low_confidence' }, saveLink: { state: 'inactive' }, ...overrides });
const summary = { active: 4, needsConfirmation: 2, failed: 1, completedToday: 6, timezone: 'Australia/Sydney', asOf: '2026-10-04T04:00:00Z', labels: { completedToday: 'Enriched, updated today' }, definitions: { population: 'All enrichment requests', completedToday: 'Not first completions' } };
const detail = (extra = {}) => ({ request: { status: 'enriched', createdAt: '2026-09-14T00:00:00Z' }, source: { sourceUrl: 'https://instagram.com/p/example', platform: 'instagram', postingAccount: { username: 'creator' } }, path: 'reuse', currentPlace: row('x').currentPlace, extractionCandidate: 'Old candidate', diagnostics: { extraction: { acquisition: 'checkpoint_available', extractor: 'Jev', extractionRoute: 'jev', placeRoute: 'Rich → Google Places' }, trace: { availability: 'recorded', schemaVersion: 1, events: [] } }, ...extra });
function harness(handler) {
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(m => [m[1], new Element(m[1])]));
  const tabs = ['enrichment', 'places', 'accounts', 'analytics'].map(tab => { const e = new Element(); e.dataset.tab = tab; return e; });
  const views = tabs.map(t => elements.get(`view-${t.dataset.tab}`));
  for (const id of ['metric-active', 'metric-needs-help', 'metric-failed', 'metric-completed']) elements.get(id).parentElement = new Element();
  elements.get('history-limit').value = '50';
  const document = new Element(); document.hidden = false; document.getElementById = id => { assert.ok(elements.has(id), `Unknown DOM ID ${id}`); return elements.get(id); };
  document.querySelectorAll = selector => selector === '.tab' ? tabs : selector === '.view' ? views : [];
  const requests = [], intervals = [], clipboard = [];
  let googleRenders = 0;
  const window = { setInterval: fn => { intervals.push(fn); return intervals.length; }, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}, location: { reload() {} }, google: { accounts: { id: { initialize() {}, renderButton() { googleRenders++; } } } } };
  const respond = async (url, options = {}) => {
    const u = new URL(url); requests.push({ url: u, options });
    const result = await handler?.(u, options);
    let body = result?.body, status = result?.status ?? 200;
    if (body === undefined) {
      if (u.pathname.endsWith('/session')) body = { authenticated: true, email: 'admin@example.test' };
      else if (u.pathname.endsWith('/config')) body = { googleClientId: 'fixture-client' };
      else if (u.pathname.endsWith('/summary')) body = summary;
      else if (u.pathname.endsWith('/history')) body = { items: [row('capture-one')], filters: Object.fromEntries(u.searchParams), hasMore: true, nextCursor: 'opaque-token', timezone: 'Australia/Sydney', asOf: summary.asOf, membership: 'Live membership: status/name changes and late commits may change results.' };
      else body = detail();
    }
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  vm.runInNewContext(script, { document, window, fetch: respond, navigator: { clipboard: { writeText: async value => clipboard.push(value) } }, URL, URLSearchParams, Date, Intl, Set, AbortController, console: { error() {} } });
  return { elements, tabs, document, requests, intervals, clipboard, googleRenders: () => googleRenders, click: id => elements.get(id).emit('click'), submit: id => elements.get(id).emit('submit') };
}
test('global cards, factual source, manual current identity and no table URLs', async () => {
  const h = harness(); await flush();
  assert.equal(h.elements.get('metric-active').textContent, 4);
  assert.match(h.elements.get('summary-meta').textContent, /Global enrichment requests/);
  assert.equal(h.elements.get('metric-completed').parentElement.child.textContent, 'Enriched, updated today');
  const rendered = h.elements.get('enrichment-body').innerHTML;
  assert.match(rendered, /Current Place/); assert.match(rendered, /Old candidate/);
  assert.match(rendered, /Current inactive Save/); assert.match(rendered, /Not a proven historical request outcome/);
  assert.match(rendered, /@creator/); assert.doesNotMatch(rendered, /https:|sourceUrl/);
  for (const request of h.requests) { assert.equal(request.options.credentials, 'include'); assert.equal(request.options.cache, 'no-store'); }
});
test('opaque cursor repeats explicit filters; older pages pause polling; Refresh resets', async () => {
  const h = harness(u => u.searchParams.has('cursor') ? { body: { items: [row('capture-two')], filters: Object.fromEntries([...u.searchParams].filter(([k]) => k !== 'cursor')), hasMore: false, nextCursor: null } } : undefined);
  await flush(); await h.click('history-more'); await flush();
  const history = h.requests.filter(r => r.url.pathname.endsWith('/history'));
  assert.equal(history[1].url.searchParams.get('cursor'), 'opaque-token');
  for (const key of ['from', 'to', 'status', 'platform', 'q', 'limit']) assert.equal(history[1].url.searchParams.get(key), history[0].url.searchParams.get(key));
  assert.match(h.elements.get('enrichment-body').innerHTML, /capture-two/);
  h.intervals[0](); await flush();
  assert.equal(h.requests.filter(r => r.url.pathname.endsWith('/history')).length, 2);
  await h.click('refresh'); await flush();
  assert.equal(h.requests.filter(r => r.url.pathname.endsWith('/history')).at(-1).url.searchParams.has('cursor'), false);
});
test('inclusive date picker advances a calendar day across both Sydney DST dates; search stays literal', async () => {
  const h = harness(); await flush();
  for (const day of ['2026-04-05', '2026-10-04']) {
    h.elements.get('history-from').value = day; h.elements.get('history-through').value = day;
    h.elements.get('history-search').value = '  café_%\\  ';
    await h.submit('history-form'); await flush();
    const url = h.requests.filter(r => r.url.pathname.endsWith('/history')).at(-1).url;
    assert.equal(url.searchParams.get('from'), day); assert.equal(url.searchParams.get('to'), day === '2026-04-05' ? '2026-04-06' : '2026-10-05');
    assert.equal(url.searchParams.get('q'), 'café_%\\');
  }
  h.elements.get('history-from').value = '2020-01-01';
  const before = h.requests.length; await h.submit('history-form'); await flush();
  assert.match(h.elements.get('history-error').textContent, /1–366/);
  assert.equal(h.requests.filter(r => r.url.pathname.endsWith('/history')).at(-1).url.searchParams.get('from'), '2026-10-04');
  assert.ok(h.requests.length >= before); // Summary remains independently refreshable.
});
test('invalid cursor is retried once without token, never loops', async () => {
  const h = harness(u => u.searchParams.has('cursor') ? { status: 400, body: { error: 'expired' } } : undefined);
  await flush(); await h.click('history-more'); await flush();
  const calls = h.requests.filter(r => r.url.pathname.endsWith('/history'));
  assert.equal(calls.length, 3); assert.equal(calls[2].url.searchParams.has('cursor'), false);
  assert.equal(h.elements.get('history-error').hidden, true);
});
test('out-of-order history responses cannot overwrite newer search', async () => {
  let resolveOld;
  const h = harness(u => u.searchParams.get('q') === 'old' ? new Promise(resolve => { resolveOld = resolve; }) : undefined);
  await flush(); h.elements.get('history-search').value = 'old'; h.submit('history-form'); await flush();
  h.elements.get('history-search').value = 'new'; await h.submit('history-form'); await flush();
  resolveOld({ body: { items: [row('stale-result')], filters: { q: 'old' }, hasMore: false } }); await flush();
  assert.doesNotMatch(h.elements.get('enrichment-body').innerHTML, /stale-result/);
});
test('ambiguity stays unknown; candidates cannot become trusted Places; payload HTML is escaped', async () => {
  const h = harness(u => u.pathname.endsWith('/history') ? { body: { items: [row('safe', { source: { platform: 'web', ambiguous: true, postingAccount: { username: 'must-not-display' } }, currentPlace: { name: 'Not trusted', authority: 'unknown' }, extractionCandidate: '<img onerror=alert(1)>' })], filters: {}, hasMore: false } } : undefined);
  await flush(); const content = h.elements.get('enrichment-body').innerHTML;
  assert.match(content, /Unresolved/); assert.match(content, /ambiguous/); assert.doesNotMatch(content, /must-not-display|Not trusted|<img/); assert.match(content, /&lt;img/);
});
test('Analytics shows exact values, separate denominators, unavailable cost; errors are not zero', async () => {
  let failure = false;
  const data = { from: '2026-10-01', to: '2026-10-04', timezone: 'Australia/Sydney', asOf: summary.asOf, days: [{ day: '2026-10-01', saveActions: 0 }, { day: '2026-10-02', saveActions: 4 }, { day: '2026-10-03', saveActions: 2 }], saveActions: { total: 6, denominator: 'retained saved events', methodology: 'Re-saves included; unsave does not subtract history' }, requestOutcomes: { total: 3, denominator: 'requests created in range', methodology: 'Current outcomes, not outcomes per Save action', counts: { pending: 0, processing: 0, needs_confirmation: 1, failed: 0, enriched: 2 } }, cost: { amount: null, availability: 'unavailable', reason: 'Usage unavailable' } };
  const h = harness(u => u.pathname.endsWith('/daily') ? { status: failure ? 500 : 200, body: failure ? {} : data } : undefined);
  await flush(); await h.tabs[3].emit('click'); await flush();
  const content = h.elements.get('analytics-content').innerHTML;
  assert.match(content, /Save actions per day/); assert.match(content, /Exact daily values/); assert.match(content, /2026-10-02<\/th><td>4/); assert.match(content, /Unavailable/); assert.match(content, /requests created in range/); assert.doesNotMatch(content, /\$0/);
  const count = h.requests.filter(r => r.url.pathname.endsWith('/daily')).length; h.intervals[0](); await flush(); assert.equal(h.requests.filter(r => r.url.pathname.endsWith('/daily')).length, count);
  failure = true; await h.submit('analytics-form'); await flush();
  assert.equal(h.elements.get('analytics-content').hidden, true); assert.match(h.elements.get('analytics-error').textContent, /not a zero/);
});
test('session expiry hides app and stops polling without treating denied data as empty', async () => {
  let expired = false;
  const h = harness(u => expired && u.pathname.endsWith('/history') ? { status: 401, body: {} } : undefined);
  await flush(); expired = true; await h.click('refresh'); await flush();
  // Trigger controlled Google-ready interval if needed.
  for (const fn of h.intervals.slice(1)) fn(); await flush();
  assert.equal(h.elements.get('app').hidden, true); assert.equal(h.elements.get('signed-out').hidden, false); assert.match(h.elements.get('auth-error').textContent, /session has ended/);
  const before = h.requests.length; h.intervals[0](); await flush(); assert.equal(h.requests.length, before);
});
test('keyboard tabs have selected/roving focus semantics and page retains noindex', async () => {
  const h = harness(); await flush(); await h.tabs[0].emit('keydown', { key: 'End' }); await flush();
  assert.equal(h.tabs[3].attributes['aria-selected'], 'true'); assert.equal(h.tabs[3].tabIndex, 0); assert.equal(h.tabs[0].tabIndex, -1);
  assert.match(html, /noindex,nofollow,noarchive/);
});

test('retained extractor is bound label or Unknown; reuse and selection do not invent invocations', async () => {
  let old = false;
  const events = [
    { task: 'rich_extraction', event: 'reused', outcome: 'already_present', provider: 'jev', requestedModel: 'should-not-replay', attemptedRequests: 99 },
    { task: 'rich_extraction', event: 'completed', route: 'xai_fallback', outcome: 'success', fallbackOccurred: true },
    { task: 'rich_extraction', event: 'completed', provider: 'jev', requestedModel: 'jev-model', attemptedRequests: 7 },
    { task: 'rich_extraction', event: 'failed', provider: 'xai', reason: 'multimodal_fallback', providerAttemptNo: 1 },
    { task: 'place_decision', event: 'completed', provider: 'jev', route: 'rich_xai_google' },
  ];
  const h = harness(u => /\/enrichment\/capture-one$/.test(u.pathname) ? { body: detail(old ? { diagnostics: undefined } : { diagnostics: { extraction: { extractor: 'Jev', acquisition: 'checkpoint_available', extractionRoute: 'jev', placeRoute: 'Rich → Google Places' }, trace: { availability: 'recorded', schemaVersion: 1, events } } }) } : undefined);
  await flush(); await h.elements.get('enrichment-body').buttons[0].emit('click'); await flush();
  let content = h.elements.get('drawer-content').innerHTML;
  assert.match(content, /Retained extraction provider<\/span><strong>Jev/);
  assert.match(content, /checkpoint reuse — no new extractor invocation/); assert.doesNotMatch(content, /should-not-replay|99 Jev/);
  assert.match(content, /7 Jev requests/); assert.match(content, /Extraction route selected/);
  assert.match(content, /fallback selected; invocation requires a separate outcome event/);
  assert.match(content, /Place judgment \(separate from extraction\)/); assert.match(content, /request count not recorded/);
  assert.match(content, /Rich → Google Places/); assert.doesNotMatch(content, /rich_xai_google/);
  old = true; await h.click('refresh'); await flush(); content = h.elements.get('drawer-content').innerHTML;
  assert.match(content, /Retained extraction provider<\/span><strong>Unknown/);
  assert.match(content, /Checkpoint availability<\/span><strong>Unknown/);
});
test('original links reject executable protocols; case-file copy preserves machine text and routes', async () => {
  const exported = { route: 'rich_xai_google', error: 'xAI extraction failed (transient_error): example', diagnostics: { extractor: 'Unknown' } };
  const h = harness(u => u.pathname.endsWith('/case-file') ? { body: exported } : /\/enrichment\/capture-one$/.test(u.pathname) ? { body: detail({ source: { sourceUrl: 'javascript:alert(1)' }, request: { status: 'failed', errorMessage: exported.error }, evidence: { route: exported.route } }) } : undefined);
  await flush(); await h.elements.get('enrichment-body').buttons[0].emit('click'); await flush();
  const content = h.elements.get('drawer-content').innerHTML;
  assert.doesNotMatch(content, /href="javascript:/); assert.match(content, /Rich extraction failed/);
  await h.click('drawer-copy'); await flush(); assert.deepEqual(JSON.parse(h.clipboard[0]), exported);
});
