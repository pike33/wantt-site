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

  let activeTab = 'enrichment';
  let activeFilter = 'all';
  let enrichmentRows = [];
  let pollTimer = null;
  let detailCaptureId = null;

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

  const timelineItem = (title, detail) => `<div class="timeline-item">
    <span class="timeline-dot"></span>
    <div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small></div>
  </div>`;

  const openDetail = async (captureId) => {
    detailCaptureId = captureId;
    drawerTitle.textContent = captureId.slice(0, 12);
    drawerContent.innerHTML = '<p class="muted">Loading diagnostic detail…</p>';
    drawerBackdrop.hidden = false;
    drawer.classList.add('is-open');
    drawer.setAttribute('aria-hidden', 'false');

    const result = await api(`/admin/api/enrichment/${encodeURIComponent(captureId)}`);
    if (!result.response.ok) {
      drawerContent.innerHTML = '<p class="error">Could not load this enrichment request.</p>';
      return;
    }
    const d = result.body;
    const r = d.request || {};
    const source = d.source || {};
    const decision = d.decision || {};
    const extraction = d.extraction || null;
    const attempts = Array.isArray(d.attempts) ? d.attempts : [];
    const recommendations = Array.isArray(d.recommendations) ? d.recommendations : [];
    const manual = d.manualConfirmation || null;

    const stages = [];
    stages.push(timelineItem('Captured', formatDateTime(r.createdAt)));
    if (d.evidenceMilestones?.layer1FetchedAt) stages.push(timelineItem('Instagram evidence fetched', formatDateTime(d.evidenceMilestones.layer1FetchedAt)));
    if (d.evidenceMilestones?.layer2FetchedAt) stages.push(timelineItem('Transcript stage completed', formatDateTime(d.evidenceMilestones.layer2FetchedAt)));
    if (extraction) stages.push(timelineItem('xAI extraction persisted', `confidence ${Number(extraction.confidence ?? decision.extractionConfidence ?? 0).toFixed(2)} · ${extraction.venueName || 'no primary venue'}`));
    if (decision.decisionReason) stages.push(timelineItem('Place decision', `${decisionLabel(decision.decisionReason)}${decision.placesClassification ? ` · ${decision.placesClassification}` : ''}`));
    attempts.forEach((a) => stages.push(timelineItem(
      `Cycle ${a.cycle} · attempt ${a.attemptNo} · ${a.outcome}`,
      `${formatDateTime(a.occurredAt)}${a.errorMessage ? ` · ${a.errorMessage}` : ''}`
    )));
    if (manual) stages.push(timelineItem('Manual Place confirmation', `${manual.name || 'Place'} · ${formatDateTime(manual.confirmedAt)}`));
    stages.push(timelineItem(`Current state: ${statusLabel(r.status)}`, formatDateTime(r.updatedAt)));

    drawerContent.innerHTML = `
      <div class="detail-grid">
        <div class="detail-stat"><span>Status</span><strong>${escapeHtml(statusLabel(r.status))}</strong></div>
        <div class="detail-stat"><span>Path</span><strong>${escapeHtml(d.path || '—')}</strong></div>
        <div class="detail-stat"><span>Elapsed</span><strong>${escapeHtml(formatDuration(r.elapsedMs))}</strong></div>
        <div class="detail-stat"><span>Saver</span><strong>${escapeHtml(d.saverPseudoId || 'anonymous')}</strong></div>
      </div>

      <section class="detail-section">
        <h3>Journey</h3>
        <div class="timeline">${stages.join('')}</div>
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
        <h3>xAI extraction</h3>
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

      <section class="detail-section">
        <h3>Durable evidence</h3>
        <pre>${escapeHtml(pretty(d.evidence))}</pre>
      </section>
    `;
  };

  const closeDetail = () => {
    detailCaptureId = null;
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
