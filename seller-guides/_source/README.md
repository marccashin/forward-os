# Seller Guide (two-page seller one-sheet)

One PDF per agent in `seller-guides/`, linked from FORWARD OS by login name
(`SELLER_GUIDES` in `index.html`). Agents send it before a listing appointment;
the full Listing Presentation (Canva) is still presented in person.

- All five are built by `build.py`. Charlotte's was her approved original of
  2026-09-29 until Oct 27, 2026, when the trusted partners block was added to
  page 2 for everyone and hers was rebuilt from this source (same words; a line
  break or two in her bio moved).
- `agents.json` holds the only things that differ per agent: photo, bio, phone,
  email, testimonial(s). Bio and testimonials are copied from each agent's own
  page in their Canva listing presentation. Never write a testimonial here that
  a client did not give.
- Shared copy (what to expect, buyer avatars, the eight steps, team figures,
  trusted partners) lives in `build.py`. Page 2 is shared and nearly full: the
  build stops if any agent's page overflows, so check all five after an edit.
- The title partner line is a request, never a requirement: the buyer chooses
  the title company (RESPA).

## Rebuild

    python3 build.py                 # every agent
    python3 build.py niki-lang       # one agent

Needs Python Playwright with Chromium (set `SG_CHROMIUM` to a Chromium binary if
Playwright cannot find one). The script stops with an error if an agent's content
does not fit on the page rather than clipping it.

## Adding an agent

1. Add their photo to `assets/<slug>.jpg` (portrait, about 700px wide).
2. Add them to `agents.json`.
3. Run `build.py <slug>`.
4. Add one line to `SELLER_GUIDES` in `index.html` with their exact login name.
