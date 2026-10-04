(() => {
  const API_BASE = 'https://api.wantt.io';
  const POLL_MS = 5000;
  const TIMEZONE = 'Australia/Sydney';

  const $ = (id) => document.getElementById(id);
  const authCard = $('auth-card');
  const loading = $('loading');
  const signedOut = $('signed-out');
  const authError = $('auth-error');
  const app = $('app');
  const identity = $('identity');
  const signoutButton = $('signout');
  const refreshButton = $('refresh');
  const drawer = $('detail-drawer');
  const drawerBackdrop = $('drawer-backdrop');
  const drawerContent = $('drawer-content');
  const drawerTitle = $('drawer-title');
  const drawerCopy = $('drawer-copy');

  let activeTab = 'enrichment';
  let historyFilters = null;
  let nextCursor = null;
  let historyPages = 0;
  let historyGeneration = 0;
  let historyAbort = null;
  let analyticsGeneration = 0;
  let analyticsAbort = null;
  let refreshInFlight = false;
  let authenticated = false;
  let summaryGeneration = 0;
  let googleReady = false;
  let preparingSignIn = false;
  let enrichmentRows = [];
  let pollTimer = null;
  let detailCaptureId = null;
  let detailPayload = null;
  let detailRequestToken = 0;
  let copyResetTimer = null;

  const copyIcon = `<svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="8" y="8" width="11" height="11" rx="2"></rect>
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path>
  </svg>`;
  const checkIcon = `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="m5 12 4 4L19 6"></path>
  </svg>`;
  const errorIcon = `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 8v5"></path><path d="M12 17h.01"></path><circle cx="12" cy="12" r="9"></circle>
  </svg>`;

  const resetCopyButton = () => {
    if (copyResetTimer) window.clearTimeout(copyResetTimer);
    copyResetTimer = null;
    drawerCopy.classList.remove('is-success', 'is-error');
    drawerCopy.innerHTML = copyIcon;
    drawerCopy.setAttribute('aria-label', 'Copy diagnostic case file');
    drawerCopy.title = 'Copy diagnostic case file';
  };

  const showCopyState = (state) => {
    if (copyResetTimer) window.clearTimeout(copyResetTimer);
    drawerCopy.classList.toggle('is-success', state === 'success');
    drawerCopy.classList.toggle('is-error', state === 'error');
    drawerCopy.innerHTML = state === 'success' ? checkIcon : errorIcon;
    const message = state === 'success' ? 'Diagnostic case file copied' : 'Could not copy case file';
    drawerCopy.setAttribute('aria-label', message);
    drawerCopy.title = message;
    copyResetTimer = window.setTimeout(resetCopyButton, 1800);
  };

  const api = async (path, options = {}) => {
    const headers = { ...(options.headers || {}) };
    if (options.body !== undefined && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      credentials: 'include',
      cache: 'no-store',
      headers,
    });
    const body = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) {
      authenticated = false;
      stopPolling();
      historyAbort?.abort();
      analyticsAbort?.abort();
      closeDetail();
      showSignedOut();
      showError('Your Admin session has ended. Sign in again.');
      void prepareSignIn();
    }
    return { response, body };
  };

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  // Human presentation only; exported case files retain original machine values.
  const routeLabel = (route) => ({ rich_xai_google: 'Rich → Google Places',
    narrow_primary: 'Narrow → Google Places', direct: 'Direct → Google Places' }[route] || route);
  const displayValue = (value) => JSON.parse(JSON.stringify(value ?? null, (_key, item) =>
    typeof item === 'string' ? String(routeLabel(item)).replace(/^xAI extraction failed /, 'Rich extraction failed ') : item));
  const pretty = (value) => JSON.stringify(displayValue(value), null, 2);
  const safeSourceUrl = (value) => {
    try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; }
    catch { return null; }
  };
  const platformLabel = (platform) => ({ instagram: 'Instagram', tiktok: 'TikTok', google_maps: 'Google Maps', web: 'Website', unknown: 'Unknown source' }[platform] || 'Unknown source');
  const creatorLabel = (source = {}) => source.ambiguous ? 'Multiple posting accounts — ambiguous'
    : source.postingAccount?.username ? `@${String(source.postingAccount.username).replace(/^@/, '')}`
    : source.postingAccount?.displayName || 'Creator unknown';
  const retainedExtractor = (detail) => ['Jev', 'xAI'].includes(detail?.diagnostics?.extraction?.extractor)
    ? detail.diagnostics.extraction.extractor : 'Unknown';
  const calendarDay = (date = new Date()) => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type).value).join('-');
  };
  const shiftDay = (day, offset) => {
    const date = new Date(`${day}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  };
  const readRange = (prefix) => {
    const from = $(`${prefix}-from`).value;
    const through = $(`${prefix}-through`).value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(through)) throw new Error('Choose both dates.');
    const to = shiftDay(through, 1);
    const days = (Date.parse(to) - Date.parse(from)) / 86400000;
    if (days < 1 || days > 366) throw new Error('Choose a range of 1–366 Sydney calendar days.');
    return { from, to };
  };
  const showPanelError = (id, message = '') => { $(id).textContent = message; $(id).hidden = !message; };

  const formatDateTime = (iso) => {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat(undefined, {
      timeZone: TIMEZONE, timeZoneName: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit',
    }).format(date);
  };

  const formatRelative = (iso) => {
    if (!iso) return '—';
    const ms = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(ms)) return '—';
    if (ms < 60_000) return `${Math.max(0, Math.round(ms / 1000))}s ago`;
    if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
    if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
    return `${Math.round(ms / 86_400_000)}d ago`;
  };

  const formatDuration = (ms) => {
    if (ms === null || ms === undefined || !Number.isFinite(Number(ms))) return '—';
    const n = Number(ms);
    if (n < 1000) return `${Math.round(n)}ms`;
    if (n < 60_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}s`;
    return `${(n / 60_000).toFixed(1)}m`;
  };

  const statusLabel = (status) => ({
    pending: 'Pending',
    processing: 'Processing',
    enriched: 'Enriched',
    needs_confirmation: 'Needs confirmation',
    failed: 'Failed',
  }[status] || status);

  const decisionLabel = (reason) => ({
    successful_auto_commit: 'auto-commit',
    low_confidence: 'low confidence',
    no_venue_name: 'no venue name',
    ambiguous: 'ambiguous',
    no_match: 'no match',
    provider_error: 'provider error',
  }[reason] || reason || '—');

  const taskLabel = (task) => ({
    source_fetch: 'Source fetched',
    transcript: 'Transcript',
    source_media: 'Source media',
    place_direct_validation: 'Direct Place validation',
    place_discovery: 'Place discovery',
    candidate_search: 'Google candidate search',
    place_decision: 'Place decision',
    primary_persistence: 'Primary persistence',
    rich_extraction: 'Rich extraction',
    secondary_place: 'Secondary Places',
    rich_persistence: 'Rich persistence',
    representative_image: 'Representative image',
    manual_confirmation: 'Manual confirmation',
    manual_retry: 'Manual retry',
    terminal_state: 'Terminal state',
  }[task] || task || 'Lifecycle event');

  const getTraceState = (detail) => {
    const trace = detail?.diagnostics?.trace;
    if (!trace || !['recorded', 'not_recorded', 'invalid'].includes(trace.availability)) {
      return {
        availability: 'not_recorded',
        schemaVersion: null,
        droppedEvents: 0,
        events: [],
      };
    }
    return {
      availability: trace.availability,
      schemaVersion: trace.schemaVersion ?? null,
      droppedEvents: trace.droppedEvents ?? (trace.availability === 'recorded' ? 0 : null),
      events: trace.availability === 'recorded' && Array.isArray(trace.events) ? trace.events : [],
    };
  };

  const authoritySummary = (trace, manual) => {
    if (manual) return 'Manual';
    if (trace.availability === 'recorded'
      && trace.events.some((event) => event.authorityAfter === 'automatic')) {
      return 'Automatic';
    }
    return trace.availability === 'recorded' ? 'None' : '—';
  };

  const trustedPrimaryDuration = (request, trace) => {
    if (trace.availability !== 'recorded' || !request?.createdAt) return null;
    const start = new Date(request.createdAt).getTime();
    if (!Number.isFinite(start)) return null;
    const authorityTimes = trace.events
      .filter((event) => event.authorityAfter === 'automatic' || event.authorityAfter === 'manual')
      .map((event) => new Date(event.at).getTime())
      .filter(Number.isFinite);
    if (!authorityTimes.length) return null;
    const elapsed = Math.min(...authorityTimes) - start;
    return elapsed >= 0 ? elapsed : null;
  };

  const richCompletionSummary = (trace) => {
    if (trace.availability !== 'recorded') return 'Not recorded';
    const rich = trace.events.filter((event) => event.lane === 'rich');
    let lastSuccess = -1;
    let lastFailure = -1;
    rich.forEach((event, index) => {
      if (
        event.task === 'rich_persistence'
        && event.event === 'completed'
        && (
          event.outcome === 'persisted'
          || event.outcome === 'succeeded'
          || event.outputSummary?.persisted === true
        )
      ) {
        lastSuccess = index;
      }
      if (
        event.event === 'failed'
        && (
          event.outcome === 'permanent_failure'
          || event.outcome === 'failed'
          || event.reason === 'retry_exhausted'
          || event.reason === 'attempt_limit'
          || event.reason === 'time_budget'
        )
      ) {
        lastFailure = index;
      }
    });
    if (lastFailure > lastSuccess) return 'Failed';
    if (lastSuccess >= 0) return 'Complete';
    return rich.some((event) => event.event !== 'skipped') ? 'Partial' : 'Not recorded';
  };

  const compactEvidenceForDisplay = (evidence, trace) => {
    const display = evidence && typeof evidence === 'object' && !Array.isArray(evidence)
      ? { ...evidence }
      : {};
    display.diagnosticTraceV1 = trace.availability === 'recorded'
      ? {
          availability: 'recorded',
          schemaVersion: trace.schemaVersion,
          eventCount: trace.events.length,
          droppedEvents: trace.droppedEvents,
        }
      : {
          availability: trace.availability,
          schemaVersion: trace.schemaVersion,
        };
    return display;
  };

  const traceEventTitle = (event) => {
    if (event.task === 'source_fetch' && event.event === 'reused') return 'Source reused';
    if (event.task === 'terminal_state' && event.event === 'reused' && event.outcome === 'enriched') {
      return 'Enriched from reusable canonical state';
    }
    if (event.task === 'rich_extraction' && event.event === 'reused') return 'Extraction checkpoint reused';
    if (event.task === 'place_decision') return 'Place judgment (separate from extraction)';
    if (event.task === 'rich_extraction' && !event.provider && ['legacy_xai', 'xai_fallback'].includes(event.route)) return 'Extraction route selected';
    return taskLabel(event.task);
  };

  const traceTone = (event) => {
    if (
      event.event === 'failed'
      || ['failed', 'permanent_failure', 'retryable_failure'].includes(event.outcome)
    ) return 'failed';
    if (event.authorityAfter === 'manual') return 'manual';
    if (
      ['trusted', 'persisted', 'enriched', 'succeeded'].includes(event.outcome)
      || event.outputSummary?.persisted === true
    ) return 'success';
    return 'neutral';
  };

  const traceEventDetails = (event) => {
    const parts = [];
    if (event.event) parts.push(event.event);
    if (event.outcome) parts.push(event.outcome);
    const reused = event.task === 'rich_extraction' && event.event === 'reused';
    if (reused) parts.push('checkpoint reuse — no new extractor invocation');
    else if (event.provider) parts.push(event.provider);
    if (event.route) parts.push(routeLabel(event.route));
    if (!reused && event.provider && (event.requestedModel || event.servedModel)) {
      const requested = event.requestedModel || '—';
      const served = event.servedModel || requested;
      parts.push(requested === served ? served : `${requested} → ${served}`);
    }
    if (event.durationMs != null && Number.isFinite(Number(event.durationMs))) {
      parts.push(formatDuration(event.durationMs));
    }
    if (Number.isInteger(event.retryCycle)) parts.push(`cycle ${event.retryCycle}`);
    if (Number.isInteger(event.attemptNo)) parts.push(`attempt ${event.attemptNo}`);
    if (Number.isInteger(event.providerAttemptNo)) {
      parts.push(`provider attempt ${event.providerAttemptNo}`);
    }
    if (Number.isInteger(event.continuationGeneration)) {
      parts.push(`continuation ${event.continuationGeneration}`);
    }
    if (event.authorityBefore || event.authorityAfter) {
      parts.push(`authority ${event.authorityBefore || '—'} → ${event.authorityAfter || '—'}`);
    }
    const input = event.inputSummary || {};
    const output = event.outputSummary || {};
    if (Number.isInteger(input.candidateCount)) parts.push(`${input.candidateCount} input candidates`);
    if (Number.isInteger(input.mediaCount)) parts.push(`${input.mediaCount} media`);
    if (Number.isInteger(output.candidateCount)) parts.push(`${output.candidateCount} candidates`);
    if (Number.isInteger(output.resolvedCount)) parts.push(`${output.resolvedCount} resolved`);
    if (Number.isInteger(output.thingCount)) parts.push(`${output.thingCount} Things`);
    if (Number.isInteger(output.omittedCount)) parts.push(`${output.omittedCount} omitted`);
    if (output.selectedChoice === 'none_supported') parts.push('none supported');
    if (output.selectedChoice === 'candidate') {
      parts.push(Number.isInteger(output.selectedCandidateIndex)
        ? `candidate ${output.selectedCandidateIndex}`
        : 'candidate');
    }
    if (output.selectedProbability != null && Number.isFinite(Number(output.selectedProbability))) {
      parts.push(`p ${Number(output.selectedProbability).toFixed(2)}`);
    }
    if (output.trustThreshold != null && Number.isFinite(Number(output.trustThreshold))) {
      parts.push(`threshold ${Number(output.trustThreshold).toFixed(2)}`);
    }
    if (event.failure?.classification) parts.push(event.failure.classification);
    if (!reused && event.provider && Number.isInteger(event.usage?.inputTokens)) {
      parts.push(`${event.usage.inputTokens} input tokens`);
    }
    if (!reused && event.provider && Number.isInteger(event.usage?.outputTokens)) {
      parts.push(`${event.usage.outputTokens} output tokens`);
    }
    if (!reused && event.provider === 'jev' && Number.isInteger(event.attemptedRequests)) parts.push(`${event.attemptedRequests} Jev requests`);
    if (event.fallbackOccurred === true) parts.push('fallback selected; invocation requires a separate outcome event');
    if (event.reason === 'multimodal_fallback') parts.push('multimodal failure → text-only fallback');
    else if (event.reason) parts.push(event.reason);
    if (!reused && event.task === 'rich_extraction' && event.provider === 'xai') {
      if (!event.requestedModel && !event.servedModel) parts.push('model not recorded');
      parts.push('request count not recorded');
    }
    return parts;
  };

  const renderTraceEvent = (event) => {
    const tone = traceTone(event);
    const parts = traceEventDetails(event);
    return `<div class="lifecycle-event lifecycle-event-${escapeHtml(tone)}">
      <span class="lifecycle-dot" aria-hidden="true"></span>
      <div class="lifecycle-body">
        <div class="lifecycle-heading">
          <strong>${escapeHtml(traceEventTitle(event))}</strong>
          <time>${escapeHtml(formatDateTime(event.at))}</time>
        </div>
        ${parts.length ? `<div class="trace-chips">${parts.map((part) => `<span class="trace-chip">${escapeHtml(part)}</span>`).join('')}</div>` : ''}
      </div>
    </div>`;
  };

  const showSignedOut = () => {
    authCard.hidden = false;
    loading.hidden = true;
    signedOut.hidden = false;
    app.hidden = true;
  };

  const showError = (message) => {
    authError.textContent = message;
    authError.hidden = false;
  };

  const showApp = (session) => {
    authenticated = true;
    authCard.hidden = true;
    app.hidden = false;
    identity.textContent = session.email ? session.email : 'authenticated';
    startPolling();
  };

  const waitForGoogle = () => new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (window.google?.accounts?.id) {
        window.clearInterval(timer);
        resolve();
      } else if (Date.now() - started > 10000) {
        window.clearInterval(timer);
        reject(new Error('Google Sign-In did not load.'));
      }
    }, 50);
  });

  const initializeGoogle = async (clientId) => {
    await waitForGoogle();
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: async ({ credential }) => {
        authError.hidden = true;
        try {
          const { response, body } = await api('/admin/api/auth/google', {
            method: 'POST',
            body: JSON.stringify({ credential }),
          });
          if (!response.ok) {
            showError(response.status === 403
              ? 'This Google account is not authorised for Wantt Admin.'
              : 'Sign-in failed. Please try again.');
            return;
          }
          showApp(body);
          await refreshActiveView();
        } catch {
          showError('Could not reach the Wantt API. Please try again.');
        }
      },
      hd: 'wantt.io',
      use_fedcm_for_prompt: true,
    });
    googleReady = true;
    window.google.accounts.id.renderButton($('google-signin'), {
      theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', width: 280,
    });
  };

  const prepareSignIn = async () => {
    if (googleReady || preparingSignIn) return;
    preparingSignIn = true;
    try {
      const result = await api('/admin/api/config');
      if (!result.response.ok || !result.body.googleClientId) throw new Error('Admin sign-in configuration is unavailable. Reload to try again.');
      await initializeGoogle(result.body.googleClientId);
    } catch (error) { showError(error.message); }
    finally { preparingSignIn = false; }
  };

  const requireSession = async () => {
    const session = await api('/admin/api/session');
    if (session.response.status === 401 || session.response.status === 403) {
      stopPolling();
      showSignedOut();
      return false;
    }
    return session.response.ok;
  };

  const renderSummary = (summary) => {
    const cards = { active: 'active', needsConfirmation: 'needs-help', failed: 'failed', completedToday: 'completed' };
    const labels = { active: 'Active', needsConfirmation: 'Needs confirmation', failed: 'Failed', completedToday: 'Enriched, updated today' };
    for (const [field, id] of Object.entries(cards)) {
      $(`metric-${id}`).textContent = summary[field] ?? '—';
      const card = $(`metric-${id}`).parentElement;
      card.querySelector('span').textContent = summary.labels?.[field] || labels[field];
      card.title = summary.definitions?.[field] || '';
    }
    $('summary-meta').textContent = `Global enrichment requests · independent of filters · ${summary.timezone || TIMEZONE} · as of ${formatDateTime(summary.asOf)}`;
    $('summary-definitions').textContent = summary.definitions ? Object.values(summary.definitions).join('. ') : 'All request counts. Enriched, updated today counts current enriched requests updated during the Sydney day, not first completions.';
  };
  const loadSummary = async () => {
    const generation = ++summaryGeneration;
    try {
      const result = await api('/admin/api/enrichment/summary');
      if (!authenticated || generation !== summaryGeneration) return;
      if (!result.response.ok) throw new Error('Summary unavailable; counts have not been updated.');
      renderSummary(result.body);
      showPanelError('summary-error');
    } catch (error) { if (generation === summaryGeneration) showPanelError('summary-error', error.message); }
  };
  const currentPlaceMarkup = (place = {}) => {
    const valid = ['manual', 'automatic'].includes(place.authority) && place.id && place.name;
    if (!valid) return '<span class="source-main">Unresolved</span><span class="source-sub">Authority unknown</span>';
    const scope = { current_active_save: 'Current active Save', current_inactive_save: 'Current inactive Save', request_trusted_primary: 'Request trusted primary' }[place.scope] || 'Scope unknown';
    return `<span class="source-main">${escapeHtml(place.name)}</span><span class="source-sub">${escapeHtml(place.authority === 'manual' ? 'Manual' : 'Automatic')} · ${escapeHtml(scope)}</span>${place.authority === 'manual' ? '<span class="source-sub">Not a proven historical request outcome</span>' : ''}`;
  };
  const renderEnrichmentRows = () => {
    $('enrichment-empty').hidden = enrichmentRows.length !== 0;
    $('enrichment-body').innerHTML = enrichmentRows.map(row => `<tr>
      <td><button class="request-link" type="button" data-capture-id="${escapeHtml(row.captureId)}" aria-label="Inspect request ${escapeHtml(row.captureId)}">${escapeHtml(formatDateTime(row.createdAt))}</button><span class="source-sub">Updated ${escapeHtml(formatDateTime(row.updatedAt))}</span><span class="source-sub">${escapeHtml(row.captureId.slice(0, 12))}</span></td>
      <td><span class="source-main">${escapeHtml(platformLabel(row.source?.platform))}</span><span class="source-sub">${escapeHtml(creatorLabel(row.source))}</span></td>
      <td><span class="badge badge-${escapeHtml(row.status)}">${escapeHtml(statusLabel(row.status))}</span><span class="source-sub">Save ${escapeHtml(row.saveLink?.state || 'unknown')}</span></td>
      <td>${currentPlaceMarkup(row.currentPlace)}</td>
      <td>${escapeHtml(row.extractionCandidate || '—')}</td>
      <td>${escapeHtml(decisionLabel(row.retainedDecision?.reason))}<span class="source-sub">${escapeHtml(formatDateTime(row.retainedDecision?.occurredAt))}</span><span class="source-sub">Cycle association not proven</span></td>
      <td>${escapeHtml(row.attemptCount ?? '—')} total<span class="source-sub">${escapeHtml(row.failedAttemptCount ?? '—')} failed · cycle ${escapeHtml(row.retryCycle ?? '—')}</span></td>
    </tr>`).join('');
    $('enrichment-body').querySelectorAll('[data-capture-id]').forEach(button => button.addEventListener('click', () => openDetail(button.dataset.captureId)));
    $('history-count').textContent = `${enrichmentRows.length} loaded requests${nextCursor ? ' · older requests available' : ' · end of this range'}`;
    $('history-more').hidden = !nextCursor;
    $('history-live').textContent = historyPages > 1 ? 'History paused · Refresh for latest' : 'Live first page · 5s';
  };
  const readHistoryFilters = () => ({ ...readRange('history'), status: $('history-status').value,
    platform: $('history-platform').value, q: $('history-search').value.trim(), limit: Number($('history-limit').value) });
  const loadHistory = async ({ append = false, reset = false, restart = true, notice = '' } = {}) => {
    let filters;
    try { filters = reset || !historyFilters ? readHistoryFilters() : historyFilters; }
    catch (error) { showPanelError('history-error', error.message); return; }
    if (append && !nextCursor) return;
    const cursor = append ? nextCursor : null;
    const generation = ++historyGeneration;
    historyAbort?.abort();
    historyAbort = new AbortController();
    if (reset) { enrichmentRows = []; nextCursor = null; historyPages = 0; renderEnrichmentRows(); $('enrichment-empty').hidden = true; }
    $('history-more').disabled = true;
    $('history-count').textContent = append ? 'Loading older requests…' : 'Loading history…';
    try {
      const params = new URLSearchParams(filters);
      if (cursor) params.set('cursor', cursor);
      const result = await api(`/admin/api/enrichment/history?${params}`, { signal: historyAbort.signal });
      if (generation !== historyGeneration || !authenticated) return;
      if (result.response.status === 400 && append && restart) {
        $('history-notice').textContent = 'History cursor expired or became invalid. Browsing restarted from the first page.';
        return await loadHistory({ reset: true, restart: false, notice: 'History cursor expired or became invalid. Browsing restarted from the first page. ' });
      }
      if (!result.response.ok || !Array.isArray(result.body.items) || !result.body.filters) throw new Error('History unavailable. Try Refresh; this is not an empty result.');
      historyFilters = result.body.filters;
      nextCursor = result.body.hasMore ? result.body.nextCursor : null;
      const incoming = result.body.items;
      const existing = new Set(enrichmentRows.map(row => row.captureId));
      enrichmentRows = append ? [...enrichmentRows, ...incoming.filter(row => !existing.has(row.captureId))] : incoming;
      historyPages = append ? historyPages + 1 : 1;
      renderEnrichmentRows();
      $('last-updated').textContent = `as of ${formatDateTime(result.body.asOf)} · ${result.body.timezone || TIMEZONE}`;
      $('last-updated').title = `Paging watermark: ${formatDateTime(result.body.watermark)}. Refresh includes new arrivals.`;
      $('history-notice').textContent = notice + (result.body.membership || 'Live membership: status/name changes and late commits may change results. Refresh for new arrivals.');
      showPanelError('history-error');
    } catch (error) {
      if (generation !== historyGeneration || error.name === 'AbortError') return;
      showPanelError('history-error', error.message);
      $('history-count').textContent = enrichmentRows.length ? `${enrichmentRows.length} retained rows · refresh failed` : 'History not loaded';
      $('enrichment-empty').hidden = true;
    } finally { if (generation === historyGeneration) $('history-more').disabled = false; }
  };
  const loadEnrichment = async ({ reset = false, poll = false } = {}) => {
    await Promise.all([loadSummary(), !poll || historyPages <= 1 ? loadHistory({ reset }) : Promise.resolve()]);
  };
  const renderAnalytics = (data) => {
    const days = data.days;
    const max = Math.max(1, ...days.map(day => day.saveActions));
    const bars = days.map((day, index) => `<rect x="${index * 10 + 1}" y="${100 - day.saveActions / max * 90}" width="8" height="${day.saveActions / max * 90}" rx="1"><title>${escapeHtml(day.day)}: ${escapeHtml(day.saveActions)} Save actions</title></rect>`).join('');
    const counts = data.requestOutcomes.counts;
    const total = Math.max(1, data.requestOutcomes.total);
    $('analytics-content').innerHTML = `
      <div class="analytics-metrics"><article class="metric-card"><span>Save actions</span><strong>${escapeHtml(data.saveActions.total)}</strong><p class="muted">${escapeHtml(data.saveActions.denominator)}</p></article><article class="metric-card"><span>Requests created in range</span><strong>${escapeHtml(data.requestOutcomes.total)}</strong><p class="muted">Current outcomes, separate denominator</p></article><article class="metric-card"><span>Processing cost</span><strong>Unavailable</strong><p class="muted">${escapeHtml(data.cost.reason)}</p></article></div>
      <section class="analytics-panel"><h3>Save actions per day</h3><p class="muted">${escapeHtml(data.saveActions.methodology)}</p><svg class="daily-chart" viewBox="0 0 ${Math.max(10, days.length * 10)} 110" preserveAspectRatio="none" aria-hidden="true">${bars}</svg><div class="chart-range"><span>${escapeHtml(days[0]?.day || data.from)}</span><span>${escapeHtml(days.at(-1)?.day || shiftDay(data.to, -1))}</span></div><details class="methodology"><summary>Exact daily values</summary><div class="table-wrap"><table class="value-table"><caption>Save actions by Sydney calendar day</caption><thead><tr><th scope="col">Day</th><th scope="col">Save actions</th></tr></thead><tbody>${days.map(day => `<tr><th scope="row">${escapeHtml(day.day)}</th><td>${escapeHtml(day.saveActions)}</td></tr>`).join('')}</tbody></table></div></details></section>
      <section class="analytics-panel"><h3>Request outcomes</h3><p class="muted">${escapeHtml(data.requestOutcomes.methodology)} Denominator: ${escapeHtml(data.requestOutcomes.denominator)}.</p><div class="outcome-chart">${Object.entries(counts).map(([status, count]) => `<div class="outcome-row"><span>${escapeHtml(statusLabel(status))}</span><span class="outcome-track" aria-hidden="true"><span style="width:${Number(count) / total * 100}%"></span></span><strong>${escapeHtml(count)}</strong></div>`).join('')}</div><details class="methodology"><summary>Exact outcome counts</summary><table class="value-table"><caption>Current outcomes for requests created in this range</caption><thead><tr><th scope="col">Outcome</th><th scope="col">Requests</th></tr></thead><tbody>${Object.entries(counts).map(([status, count]) => `<tr><th scope="row">${escapeHtml(statusLabel(status))}</th><td>${escapeHtml(count)}</td></tr>`).join('')}</tbody></table></details></section>`;
    $('analytics-content').hidden = false;
    $('analytics-status').textContent = `${data.from} through ${shiftDay(data.to, -1)} · ${data.timezone} · as of ${formatDateTime(data.asOf)}`;
  };
  const loadAnalytics = async () => {
    let range;
    try { range = readRange('analytics'); } catch (error) { showPanelError('analytics-error', error.message); return; }
    const generation = ++analyticsGeneration;
    analyticsAbort?.abort(); analyticsAbort = new AbortController();
    $('analytics-status').textContent = 'Loading Analytics…';
    $('analytics-content').hidden = true;
    showPanelError('analytics-error');
    try {
      const result = await api(`/admin/api/analytics/daily?${new URLSearchParams(range)}`, { signal: analyticsAbort.signal });
      if (generation !== analyticsGeneration || !authenticated) return;
      if (!result.response.ok || !Array.isArray(result.body.days) || !result.body.requestOutcomes || !result.body.saveActions || !result.body.cost) throw new Error('Analytics unavailable. This is not a zero-count result.');
      renderAnalytics(result.body);
    } catch (error) {
      if (generation !== analyticsGeneration || error.name === 'AbortError') return;
      showPanelError('analytics-error', error.message);
      $('analytics-status').textContent = 'Analytics not loaded.';
    }
  };

  const renderPlaces = (items) => {
    $('places-body').innerHTML = items.map((row) => `<tr>
      <td>
        <span class="source-main">${escapeHtml(row.name)}</span>
        <span class="source-sub">${escapeHtml(row.formattedAddress || '')}</span>
      </td>
      <td>${escapeHtml(row.activeSaves)}</td>
      <td>${escapeHtml(row.distinctSavers)}</td>
      <td>${escapeHtml(row.sourcePosts)}</td>
      <td>${escapeHtml(formatRelative(row.lastSavedAt))}</td>
    </tr>`).join('');
  };

  const renderAccounts = (items) => {
    $('accounts-body').innerHTML = items.map((row) => `<tr>
      <td><span class="source-main">@${escapeHtml(String(row.ownerUsername).replace(/^@/, ''))}</span></td>
      <td>${escapeHtml(row.activeSaves)}</td>
      <td>${escapeHtml(row.distinctPosts)}</td>
      <td>${escapeHtml(row.distinctSavers)}</td>
      <td>${escapeHtml(formatRelative(row.lastSavedAt))}</td>
    </tr>`).join('');
  };

  const refreshActiveView = async ({ poll = false } = {}) => {
    if (refreshInFlight || !authenticated) return;
    const requestedTab = activeTab;
    refreshInFlight = true;
    try {
      if (activeTab === 'enrichment') {
        await loadEnrichment({ reset: !poll, poll });
      } else if (activeTab === 'analytics') {
        await loadAnalytics();
      } else if (activeTab === 'places') {
        const result = await api('/admin/api/places?limit=100');
        if (!result.response.ok) {
          if (!(await requireSession())) return;
          throw new Error('Could not load Places.');
        }
        renderPlaces(result.body.items || []);
      } else if (activeTab === 'accounts') {
        const result = await api('/admin/api/accounts?limit=100');
        if (!result.response.ok) {
          if (!(await requireSession())) return;
          throw new Error('Could not load Instagram accounts.');
        }
        renderAccounts(result.body.items || []);
      }
    } catch (error) {
      console.error('[wantt-admin]', error);
    } finally {
      refreshInFlight = false;
      if (activeTab !== requestedTab && ['places', 'accounts'].includes(activeTab)) void refreshActiveView();
    }
  };

  const renderLifecycle = (trace) => {
    if (trace.availability === 'not_recorded') {
      return `<div class="trace-notice">
        <strong>Lifecycle trace not recorded for this capture.</strong>
        <span>This is expected for captures created before lifecycle tracing was available.</span>
      </div>`;
    }
    if (trace.availability === 'invalid') {
      const version = trace.schemaVersion === null ? '' : ` Stored schema: v${trace.schemaVersion}.`;
      return `<div class="trace-notice trace-notice-warning">
        <strong>Lifecycle trace is unavailable because the stored diagnostic record is invalid.</strong>
        <span>${escapeHtml(version)}</span>
      </div>`;
    }
    const dropped = Number(trace.droppedEvents) > 0
      ? ` · ${trace.droppedEvents} older events dropped`
      : '';
    return `
      <p class="trace-meta">Trace v${escapeHtml(trace.schemaVersion)} · ${trace.events.length} events${escapeHtml(dropped)}</p>
      <div class="lifecycle">${trace.events.map(renderTraceEvent).join('')}</div>
    `;
  };

  const openDetail = async (captureId) => {
    const requestToken = ++detailRequestToken;
    detailCaptureId = captureId;
    detailPayload = null;
    resetCopyButton();
    drawerCopy.disabled = true;
    drawerTitle.textContent = captureId.slice(0, 12);
    drawerContent.innerHTML = '<p class="muted">Loading diagnostic detail…</p>';
    drawerBackdrop.hidden = false;
    drawer.classList.add('is-open');
    drawer.setAttribute('aria-hidden', 'false');

    const result = await api(`/admin/api/enrichment/${encodeURIComponent(captureId)}`).catch(() => ({ response: { ok: false }, body: {} }));
    if (requestToken !== detailRequestToken || detailCaptureId !== captureId) return;
    if (!result.response.ok) {
      drawerContent.innerHTML = '<p class="error">Could not load this enrichment request.</p>';
      return;
    }
    const d = result.body;
    detailPayload = d;
    drawerCopy.disabled = false;
    const r = d.request || {};
    const source = d.source || {};
    const decision = d.decision || {};
    const extraction = d.extraction || null;
    const attempts = Array.isArray(d.attempts) ? d.attempts : [];
    const recommendations = Array.isArray(d.recommendations) ? d.recommendations : [];
    const manual = d.manualConfirmation || null;
    const representativeImageDiagnostic = d.representativeImageDiagnostic || null;
    const trace = getTraceState(d);
    const authority = d.currentPlace?.authority || authoritySummary(trace, manual);
    const primaryMs = trustedPrimaryDuration(r, trace);
    const rich = richCompletionSummary(trace);
    const displayEvidence = compactEvidenceForDisplay(d.evidence, trace);

    drawerContent.innerHTML = `
      <div class="detail-grid">
        <div class="detail-stat"><span>State</span><strong>${escapeHtml(statusLabel(r.status))}</strong></div>
        <div class="detail-stat"><span>Authority</span><strong>${escapeHtml(authority)}</strong></div>
        <div class="detail-stat"><span>Primary</span><strong>${escapeHtml(formatDuration(primaryMs))}</strong></div>
        <div class="detail-stat"><span>Rich</span><strong>${escapeHtml(rich)}</strong></div>
      </div>
      <p class="detail-meta">
        Execution history ${escapeHtml(d.path || 'Unknown')} (heuristic) ·
        Elapsed ${escapeHtml(formatDuration(r.elapsedMs))} ·
        Saver ${escapeHtml(d.saverPseudoId || 'anonymous')}
      </p>

      ${r.errorMessage ? `<section class="detail-section"><h3>Request error</h3><pre>${escapeHtml(displayValue(r.errorMessage))}</pre></section>` : ''}
      <section class="detail-section"><h3>Current Place and retained extraction</h3>
        <div class="current-place-detail">${currentPlaceMarkup(d.currentPlace)}</div>
        <p class="muted">Extraction candidate: ${escapeHtml(d.extractionCandidate || '—')}</p>
        <div class="detail-grid">
          <div class="detail-stat"><span>Retained extraction provider</span><strong>${escapeHtml(retainedExtractor(d))}</strong></div>
          <div class="detail-stat"><span>Checkpoint availability</span><strong>${d.diagnostics?.extraction?.acquisition === 'checkpoint_available' ? 'Extraction checkpoint available' : d.diagnostics?.extraction?.acquisition === 'not_recorded' ? 'Extraction not recorded' : 'Unknown'}</strong></div>
          <div class="detail-stat"><span>Retained extraction route</span><strong>${escapeHtml(d.diagnostics?.extraction?.extractionRoute || 'Unknown')}</strong></div>
          <div class="detail-stat"><span>Place route</span><strong>${escapeHtml(d.diagnostics?.extraction?.placeRoute || 'Unknown')}</strong></div>
        </div>
        <p class="muted">Checkpoint availability does not mean fresh execution. Place judgment is separate from extraction. Current Save identity is not a proven historical request outcome.</p>
      </section>
      <section class="detail-section lifecycle-section">
        <h3>Lifecycle</h3>
        <p class="trace-meta">Event totals are not provider request counts. Observed client outcomes do not independently prove network delivery. Fallback selection and Place judgment are shown separately.</p>
        ${renderLifecycle(trace)}
      </section>

      <section class="detail-section">
        <h3>Source</h3>
        <p class="muted">${escapeHtml(platformLabel(source.platform))} · ${escapeHtml(creatorLabel(source))}</p>
        ${safeSourceUrl(source.sourceUrl) ? `<p><a class="external-link" href="${escapeHtml(safeSourceUrl(source.sourceUrl))}" target="_blank" rel="noopener noreferrer">Open original source ↗</a></p>` : ''}
        <pre>${escapeHtml(pretty({
          ownerUsername: source.ownerUsername,
          caption: source.caption,
          locationField: source.locationField,
          transcriptText: source.transcriptText,
          publishedAt: source.publishedAt,
        }))}</pre>
      </section>

      <section class="detail-section">
        <h3>Rich extraction</h3>
        <pre>${escapeHtml(pretty(extraction))}</pre>
      </section>

      <section class="detail-section">
        <h3>Decision telemetry</h3>
        <pre>${escapeHtml(pretty(decision))}</pre>
      </section>

      <section class="detail-section">
        <h3>Result / suggestion</h3>
        <pre>${escapeHtml(pretty(r.suggestion))}</pre>
      </section>

      <section class="detail-section">
        <h3>Canonical recommendations</h3>
        <pre>${escapeHtml(pretty(recommendations))}</pre>
      </section>

      <section class="detail-section">
        <h3>Retry / attempt history</h3>
        <pre>${escapeHtml(pretty(attempts))}</pre>
      </section>

      ${manual ? `<section class="detail-section"><h3>Manual authority</h3><pre>${escapeHtml(pretty(manual))}</pre></section>` : ''}

      ${representativeImageDiagnostic ? `<section class="detail-section">
        <h3>Representative image</h3>
        <pre>${escapeHtml(pretty(representativeImageDiagnostic))}</pre>
      </section>` : ''}

      <section class="detail-section">
        <h3>Durable evidence</h3>
        <pre>${escapeHtml(pretty(displayEvidence))}</pre>
      </section>
    `;
  };

  const closeDetail = () => {
    detailRequestToken += 1;
    detailCaptureId = null;
    detailPayload = null;
    drawerCopy.disabled = true;
    resetCopyButton();
    drawer.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
    drawerBackdrop.hidden = true;
  };

  const startPolling = () => {
    stopPolling();
    pollTimer = window.setInterval(() => {
      if (!document.hidden && activeTab === 'enrichment') refreshActiveView({ poll: true });
    }, POLL_MS);
  };

  const stopPolling = () => {
    if (pollTimer) window.clearInterval(pollTimer);
    pollTimer = null;
  };

  const activateTab = async (button) => {
    activeTab = button.dataset.tab;
    historyAbort?.abort(); analyticsAbort?.abort();
    ++historyGeneration; ++analyticsGeneration;
    document.querySelectorAll('.tab').forEach(b => {
      b.classList.toggle('is-active', b === button);
      b.setAttribute('aria-selected', String(b === button)); b.tabIndex = b === button ? 0 : -1;
    });
    document.querySelectorAll('.view').forEach(view => { view.hidden = true; });
    $(`view-${activeTab}`).hidden = false;
    // The old request is invalidated above; load the newly selected view directly.
    if (activeTab === 'analytics') await loadAnalytics();
    else if (activeTab === 'enrichment') await loadEnrichment({ reset: true });
    else await refreshActiveView();
  };
  const tabs = [...document.querySelectorAll('.tab')];
  tabs.forEach((button, index) => {
    button.id = `tab-${button.dataset.tab}`;
    button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', `view-${button.dataset.tab}`);
    button.setAttribute('aria-selected', String(index === 0)); button.tabIndex = index === 0 ? 0 : -1;
    const panel = $(`view-${button.dataset.tab}`); panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', button.id);
    button.addEventListener('click', () => activateTab(button));
    button.addEventListener('keydown', event => {
      const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
      if (next !== null) { event.preventDefault(); tabs[next].focus(); activateTab(tabs[next]); }
    });
  });
  for (const prefix of ['history', 'analytics']) {
    $(`${prefix}-from`).value = shiftDay(calendarDay(), -29);
    $(`${prefix}-through`).value = calendarDay();
  }
  $('history-form').addEventListener('submit', event => { event.preventDefault(); loadEnrichment({ reset: true }); });
  for (const id of ['history-from', 'history-through', 'history-status', 'history-platform', 'history-limit']) {
    $(id).addEventListener('change', () => loadEnrichment({ reset: true }));
  }
  $('analytics-form').addEventListener('submit', event => { event.preventDefault(); loadAnalytics(); });
  $('history-more').addEventListener('click', () => loadHistory({ append: true }));
  refreshButton.addEventListener('click', () => {
    refreshActiveView();
    if (detailCaptureId) openDetail(detailCaptureId);
  });
  drawerCopy.addEventListener('click', async () => {
    if (!detailCaptureId || !detailPayload || drawerCopy.disabled) return;

    const captureId = detailCaptureId;
    const requestToken = detailRequestToken;
    drawerCopy.disabled = true;
    try {
      const result = await api(
        `/admin/api/enrichment/${encodeURIComponent(captureId)}/case-file`,
      );
      if (requestToken !== detailRequestToken || detailCaptureId !== captureId) return;

      if (!result.response.ok) {
        if (result.response.status === 401 || result.response.status === 403) {
          await requireSession();
        }
        if (requestToken === detailRequestToken && detailCaptureId === captureId) {
          drawerCopy.disabled = false;
          showCopyState('error');
        }
        return;
      }

      await navigator.clipboard.writeText(JSON.stringify(result.body, null, 2));
      if (requestToken !== detailRequestToken || detailCaptureId !== captureId) return;
      drawerCopy.disabled = false;
      showCopyState('success');
    } catch {
      if (requestToken !== detailRequestToken || detailCaptureId !== captureId) return;
      drawerCopy.disabled = false;
      showCopyState('error');
    }
  });
  $('drawer-close').addEventListener('click', closeDetail);
  drawerBackdrop.addEventListener('click', closeDetail);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      historyAbort?.abort(); analyticsAbort?.abort();
    } else if (authenticated && activeTab === 'enrichment') refreshActiveView({ poll: true });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeDetail();
  });

  signoutButton.addEventListener('click', async () => {
    try {
      await api('/admin/api/signout', { method: 'POST', body: '{}' });
    } finally {
      stopPolling();
      window.location.reload();
    }
  });

  const boot = async () => {
    try {
      const session = await api('/admin/api/session');
      if (session.response.ok && session.body.authenticated) {
        showApp(session.body);
        await refreshActiveView();
        return;
      }

      showSignedOut();
      await prepareSignIn();
    } catch (error) {
      showSignedOut();
      showError(error instanceof Error ? error.message : 'Admin sign-in is unavailable.');
    }
  };

  boot();
})();

