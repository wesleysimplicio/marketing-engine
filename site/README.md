# site/ — repo-local static pages (issue #78)

This directory holds self-contained, static HTML pages built from the
Asolaria-on-metal narrative package (`SIMPLICIO-MAP-OF-MAPS.md`,
`REDUCTIONS.md`, and the campaign docs under
`.specs/strategy/campaigns/2026-Q3-asolaria-on-metal/`).

Each page is a single `index.html` with inlined CSS and no external
dependencies (no CDN, no fonts, no analytics). Open any file directly in a
browser, or serve the directory with any static file server:

```bash
npx serve site
# or
python -m http.server --directory site 8080
```

## Pages

- `simplicio-on-metal/index.html` — the "Simplicio on Metal" landing page
  requested in issue #78 (P0). Intended deploy target once a real host
  exists: `simpleti.com.br/simplicio/on-metal`.
- `asolaria-integration/index.html` — the "Simplicio + Asolaria — Agente
  Evolutivo no Metal" site section requested in issue #78 (P2), with the
  integration timeline and ecosystem map.
- `simplex-agent/index.html` — the Simplicio Agent overview requested in
  issue #133, with links to the real contracts and implementation.

## What is still external

These files are deploy-ready static assets, not a hosted site. Actually
publishing them (real domain, CDN/hosting, site navigation wiring into an
existing marketing site, and production analytics) remains external
follow-up — this repository does not own or control that hosting target.
See `.specs/strategy/campaigns/2026-Q3-asolaria-on-metal/CAMPAIGN.md` for
the full external-dependency list.
