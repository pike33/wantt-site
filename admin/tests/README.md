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

## Build 25 H companion: completion labels

The owned GLM/Jev detail uses the backend's `completion` projection for Rich,
finishing reason, source-image state and discovery confidence. An unknown discovery
dimension does not imply failed processing. Recorded coordinator reasons and
withheld-claim fields remain inspectable; copied JSON is returned unchanged from
the server. Legacy responses without `completion` keep their existing trace display.

The same test command now covers owned completion, partial claims, pending images,
generation mismatch, HTML escaping and unchanged copy payloads. Backend companion:
`saved-for-later` Build 25 H, on top of merged PR240. Publish its protected API
projection before/alongside this compatible page. No authentication, tracking,
source acquisition, provider call or native-app change is added. Signed-in
successful/partial detail inspection after publication remains an acceptance gate.

## Build 25 H current saved result

The list and drawer consume the backend's additive `currentResult` projection.
Owned Places (including private manual choices) and Things/price units lead the
detail view; legacy candidates/attempts remain disclosed technical evidence.
A thumbnail on the current Save is distinct from the latest attempt's image event.
The copied diagnostic JSON remains the server's exact machine projection.

Run `node --test admin/tests/reporting.test.cjs`: covers multi-venue grouping,
addresses, mixed authority, price units, unavailable-transcript explanation,
escaping, original-link validation, copy fidelity, session expiry, cursor/range
behaviour and old-API compatibility. The authored browser preview is not signed-in
production acceptance. Deploy backend first, then the site; compare table, drawer
and copied report on automatic, manual, multi-venue, partial and failed cases.

PR6 review coverage also preserves separate price labels and qualifiers in the
visible price, escaping them and avoiding a repeated literal condition. Backend
currentResult uses existing confirmed Thing representatives; raw occurrences remain
in technical diagnostics.
