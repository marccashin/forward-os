# Seller Guide (two-page seller one-sheet)

One PDF per agent in `seller-guides/`, linked from FORWARD OS by login name
(`SELLER_GUIDES` in `index.html`). Agents send it before a listing appointment;
the full Listing Presentation (Canva) is still presented in person.

- `Charlotte_Lee_Seller_Guide.pdf` is the approved original of 2026-09-29, kept
  byte for byte. The other four are built from the same layout by `build.py`.
- `agents.json` holds the only things that differ per agent: photo, bio, phone,
  email, testimonial(s). Bio and testimonials are copied from each agent's own
  page in their Canva listing presentation. Never write a testimonial here that
  a client did not give.
- Shared copy (what to expect, buyer avatars, the eight steps, team figures)
  lives in `build.py`.

## Rebuild

    python3 build.py                 # every agent except the approved original
    python3 build.py niki-lang       # one agent
    python3 build.py charlotte-lee   # only if her original should be replaced

Needs Python Playwright with Chromium (set `SG_CHROMIUM` to a Chromium binary if
Playwright cannot find one). The script stops with an error if an agent's content
does not fit on the page rather than clipping it.

## Adding an agent

1. Add their photo to `assets/<slug>.jpg` (portrait, about 700px wide).
2. Add them to `agents.json`.
3. Run `build.py <slug>`.
4. Add one line to `SELLER_GUIDES` in `index.html` with their exact login name.
