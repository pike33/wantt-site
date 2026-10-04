# Admin G/G2 checks

Run from the site repository root:

```sh
node --check admin/admin.js
node --test admin/tests/reporting.test.cjs
```

The tests execute the shipped script with controlled DOM and API ports. No packages,
credentials or network are required. They cover cards, current/manual authority,
creator ambiguity, safe display/export, cursor reset and filter binding, stale
responses, Sydney calendar dates, Analytics errors/denominators and session expiry.
They do not prove browser layout, Google login, production query performance or
live database correctness.

## Publication and signed-in acceptance

The app backend must first run the merged G/G2 changes (saved-for-later PRs #194
and #195). This frontend requires the protected history and daily Analytics
endpoints; an older backend gives a visible error rather than fabricated data.
Production query plans and load still need the backend's read-only verification.
No migration, index or pricing instrumentation is included in this frontend.

Before accepting the combined Admin delivery:

- Check desktop and narrow-screen layout, light/dark modes and keyboard tabs.
- Sign in; open an existing detail and copy its unchanged case file.
- Verify Jev/xAI/Unknown retained extractor labels, reuse, selected fallback and
  separate observed outcomes against real payloads. Place judgment stays separate.
- Search for a known request at least twenty days old; load older pages, change a
  filter and Refresh. Global cards must not change denominator with table filters.
- Check a manually confirmed Place and an inactive Save: current Place and
  historical extraction candidate must remain distinct. Refresh open detail after
  resolving a request; the whole row and summary must refresh.
- Check creator ambiguity and unknown creators; original URLs exist only in detail.
- Check Sydney date ranges, daily exact-value tables, successful zero counts,
  query failures and unavailable cost. Save actions and request counts differ.
- Expire the Admin session and confirm data is hidden and sign-in can resume.

No behavioral tracking or chart dependency has been added. This is an operational
reporting seed for the later product analytics work, not user-behavior analytics.
