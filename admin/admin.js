(() => {
  const API_BASE = 'https://api.wantt.io';
  const POLL_MS = 5000;
  const SLOW_MS = 30000;

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
  let activeFilter = 'all';
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
      headers,
    });
    const body = await response.json().catch(() => ({}));
    return { response, body };
  };

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const pretty = (value) => JSON.stringify(value ?? null, null, 2);

  const formatDateTime = (iso) => {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit',
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
    needs_confirmation: 'Needs help',
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
    if (event.provider) parts.push(event.provider);
    if (event.route) parts.push(event.route);
    if (event.requestedModel || event.servedModel) {
      const requested = event.requestedModel || '—';
      const served = event.servedModel || requested;
      parts.push(requested === served ? served : `${requested} → ${served}`);
    }
    if (Number.isFinite(Number(event.durationMs))) {
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
    if (Number.isFinite(Number(output.selectedProbability))) {
      parts.push(`p ${Number(output.selectedProbability).toFixed(2)}`);
    }
    if (Number.isFinite(Number(output.trustThreshold))) {
      parts.push(`threshold ${Number(output.trustThreshold).toFixed(2)}`);
    }
    if (event.failure?.classification) parts.push(event.failure.classification);
    if (Number.isInteger(event.usage?.inputTokens)) {
      parts.push(`${event.usage.inputTokens} input tokens`);
    }
    if (Number.isInteger(event.usage?.outputTokens)) {
      parts.push(`${event.usage.outputTokens} output tokens`);
    }
    if (event.reason) parts.push(event.reason);
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
    window.google.accounts.id.renderButton($('google-signin'), {
      theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', width: 280,
    });
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
    $('metric-active').textContent = summary.active ?? 0;
    $('metric-needs-help').textContent = summary.needsConfirmation ?? 0;
    $('metric-failed').textContent = summary.failed ?? 0;
    $('metric-completed').textContent = summary.completedToday ?? 0;
  };

  const filteredRows = () => enrichmentRows.filter((row) => {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'active') return row.status === 'pending' || row.status === 'processing';
    if (activeFilter === 'slow') return Number(row.elapsedMs) >= SLOW_MS;
    if (activeFilter === 'reuse') return row.path === 'reuse';
    return row.status === activeFilter;
  });

  const renderEnrichmentRows = () => {
    const rows = filteredRows();
    $('enrichment-empty').hidden = rows.length !== 0;
    $('enrichment-body').innerHTML = rows.map((row) => {
      const sourceName = row.ownerUsername ? `@${row.ownerUsername.replace(/^@/, '')}` : 'Instagram';
      const candidate = row.resolvedPlaceName || row.venueName || '—';
      const decision = decisionLabel(row.decisionReason);
      return `<tr data-capture-id="${escapeHtml(row.captureId)}">
        <td title="${escapeHtml(formatDateTime(row.createdAt))}">${escapeHtml(formatRelative(row.createdAt))}</td>
        <td>
          <span class="source-main">${escapeHtml(sourceName)}</span>
          <span class="source-sub">${escapeHtml(row.sourceUrl || '')}</span>
        </td>
        <td><span class="badge badge-${escapeHtml(row.status)}">${escapeHtml(statusLabel(row.status))}</span></td>
        <td>${escapeHtml(formatDuration(row.elapsedMs))}</td>
        <td>${escapeHtml(candidate)}</td>
        <td>${escapeHtml(decision)}</td>
        <td class="path">${escapeHtml(row.path || '—')}</td>
        <td>${escapeHtml(row.saverPseudoId || 'anonymous')}</td>
      </tr>`;
    }).join('');

    $('enrichment-body').querySelectorAll('tr[data-capture-id]').forEach((row) => {
      row.addEventListener('click', () => openDetail(row.dataset.captureId));
    });
  };

  const loadEnrichment = async () => {
    const [summaryResult, listResult] = await Promise.all([
      api('/admin/api/enrichment/summary'),
      api('/admin/api/enrichment/recent?limit=150'),
    ]);
    if (!summaryResult.response.ok || !listResult.response.ok) {
      if (!(await requireSession())) return;
      throw new Error('Could not load enrichment activity.');
    }
    renderSummary(summaryResult.body);
    enrichmentRows = Array.isArray(listResult.body.items) ? listResult.body.items : [];
    renderEnrichmentRows();
    $('last-updated').textContent = `updated ${new Intl.DateTimeFormat(undefined, {
      hour: 'numeric', minute: '2-digit', second: '2-digit',
    }).format(new Date())}`;
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

  const refreshActiveView = async () => {
    try {
      if (activeTab === 'enrichment') {
        await loadEnrichment();
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

    const result = await api(`/admin/api/enrichment/${encodeURIComponent(captureId)}`);
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
    const authority = authoritySummary(trace, manual);
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
        Path ${escapeHtml(d.path || '—')} ·
        Elapsed ${escapeHtml(formatDuration(r.elapsedMs))} ·
        Saver ${escapeHtml(d.saverPseudoId || 'anonymous')}
      </p>

      <section class="detail-section lifecycle-section">
        <h3>Lifecycle</h3>
        ${renderLifecycle(trace)}
      </section>

      <section class="detail-section">
        <h3>Source</h3>
        <p class="muted">${escapeHtml(source.ownerUsername ? `@${source.ownerUsername.replace(/^@/, '')}` : 'Instagram source')}</p>
        ${source.sourceUrl ? `<p><a class="external-link" href="${escapeHtml(source.sourceUrl)}" target="_blank" rel="noopener noreferrer">Open Instagram source ↗</a></p>` : ''}
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
      if (!document.hidden && activeTab === 'enrichment') refreshActiveView();
    }, POLL_MS);
  };

  const stopPolling = () => {
    if (pollTimer) window.clearInterval(pollTimer);
    pollTimer = null;
  };

  document.querySelectorAll('.tab').forEach((button) => {
    button.addEventListener('click', async () => {
      activeTab = button.dataset.tab;
      document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('is-active', b === button));
      document.querySelectorAll('.view').forEach((view) => { view.hidden = true; });
      $(`view-${activeTab}`).hidden = false;
      await refreshActiveView();
    });
  });

  document.querySelectorAll('.filter').forEach((button) => {
    button.addEventListener('click', () => {
      activeFilter = button.dataset.filter;
      document.querySelectorAll('.filter').forEach((b) => b.classList.toggle('is-active', b === button));
      renderEnrichmentRows();
    });
  });

  refreshButton.addEventListener('click', refreshActiveView);
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

      const config = await api('/admin/api/config');
      if (!config.response.ok || !config.body.googleClientId) {
        throw new Error('Admin auth configuration is unavailable.');
      }
      showSignedOut();
      await initializeGoogle(config.body.googleClientId);
    } catch (error) {
      showSignedOut();
      showError(error instanceof Error ? error.message : 'Admin sign-in is unavailable.');
    }
  };

  boot();
})();
