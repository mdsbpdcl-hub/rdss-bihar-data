# Bihar on RDSS

A dashboard comparing **Bihar, SBPDCL and NBPDCL** with every state and DISCOM under the
**Revamped Distribution Sector Scheme (RDSS)**, using figures from the public RDSS dashboard
(<https://rdss.powermin.gov.in/dashboard>). It updates itself twice a day.

**Live page:** `https://mdsbpdcl-hub.github.io/rdss-bihar-data/` (after GitHub Pages is switched on, see below)

## What it shows

- Smart metering: consumer, DT, feeder and boundary meters, sanctioned / awarded / communicating
- Loss reduction: LT and HT lines, transformers, substations, sanctioned / awarded / installed
- Physical progress, sanctioned cost, GBS sanctioned and GBS released
- AT&C loss, ACS-ARR gap, payable and receivable days, FY 2020-21 onward, state- and DISCOM-wise
- Bihar's rank among states (and SBPDCL / NBPDCL among DISCOMs for the yearly measures),
  SBPDCL vs NBPDCL, year-by-year and day-by-day trends

## How it updates

`.github/workflows/update-data.yml` runs `scripts/collect.mjs` at about 06:53 and 18:53 IST. The script:

1. downloads the yearly Excel files the RDSS dashboard links to;
2. opens the public state-wise progress pages in a headless browser and reads their tables,
   plus the SBPDCL / NBPDCL split for Bihar;
3. saves `data/latest.json`, `data/latest.csv` and adds today's Bihar figures to `data/history.csv`.

Only public pages are read; nothing behind the RDSS sign-in is used. If a page cannot be read,
the previous figures for that page are kept and the header shows an amber dot.

Run it by hand from the **Actions** tab → *Update RDSS data* → *Run workflow*.

## One-time setup

**Switch on GitHub Pages:** Settings → Pages → *Deploy from a branch* → `main` / `(root)` → Save.

**If GitHub's servers are ever blocked by the RDSS site:** register a self-hosted runner on a
computer in India (Settings → Actions → Runners), then add a repository variable
`RDSS_RUNNER` = `self-hosted` (Settings → Secrets and variables → Actions → Variables).

## Files

| File | What it is |
| --- | --- |
| `index.html`, `assets/` | the dashboard |
| `scripts/collect.mjs` | the collector (Playwright + SheetJS) |
| `scripts/parse.mjs` | table and Excel parsing |
| `data/latest.json` | latest full snapshot |
| `data/latest.csv` | same, flat |
| `data/history.csv` | daily Bihar / SBPDCL / NBPDCL / India values and Bihar's rank |
