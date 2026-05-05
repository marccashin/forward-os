# FORWARD OS — Session Context File
> Upload this file at the start of any new FORWARD OS Cowork chat to restore full context.

---

## What is FORWARD OS?
A Vue 3 SPA (single-file, no build step) for real estate agents.
- **Live site:** https://forward-os.netlify.app
- **Source:** https://github.com/marccashin/forward-os (main branch)
- ~13,600 lines of HTML/JS/CSS in a single index.html (as of Chat 18)

---

## Infrastructure

| Service | Purpose | Details |
|---|---|---|
| Netlify | Hosting | Site ID: 7bcc28c5-97d0-4673-abda-309325eac663 |
| Supabase | Database | Project: forward-marketing-os (ID: ewedrgopezogifzysusn) |
| Railway | Python backend | RAILWAY_URL in index.html |
| Google Drive | LOTA video uploads + client file storage | OAuth via marc@marccashin.com |
| GitHub | Source backup + auto-deploy | github.com/marccashin/forward-os |
| Resend | Transactional email | Domain: marccashin.com (verified via GoDaddy auto-configure). From: FORWARD OS <digest@marccashin.com> |

---

## Pushing Code (No PAT Required — Permanent Setup)

The function at `/.netlify/functions/github-push`:
1. Reads `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` from Netlify env vars
2. Signs a JWT (RS256), exchanges for short-lived installation token
3. Uses that token to push files to `marccashin/forward-os`

### GitHub App details
- App ID: 3382390 | Installation ID: 124051198
- Netlify env vars: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` (base64 PEM)

### Standard push workflow (from Claude Code / Cowork shell)
```bash
cd /tmp && git clone https://github.com/marccashin/forward-os.git
# edit index.html via Python scripts
cd forward-os && git config user.email "marc@marccashin.com" && git config user.name "Marc Cashin"
git remote set-url origin https://marccashin:GITHUB_PAT@github.com/marccashin/forward-os.git
git add index.html && git commit -m "describe change" && git push origin main
```

### CRITICAL: Use Python substring/replace scripts for edits — never hand-edit 13k line files.
### CRITICAL: Verify replacements were applied with grep/python checks before pushing.

---

## Supabase Tables

| Table | Key Columns | Purpose |
|---|---|---|
| `buyers` | id, buyer_name, agent_name, drive_folder_id, subfolder_drive_ids, email, created_at | Buyer records |
| `properties` | id, address, agent_name, drive_folder_id, subfolder_drive_ids, created_at | Listing records |
| `buyer_assets` | id, buyer_id, subfolder, file_name, drive_link, created_at | Files for buyers |
| `property_assets` | id, property_id, subfolder, file_name, drive_link, created_at | Files for listings |
| `property_notes` | id, property_id, subfolder, content, updated_by, updated_at | Text notes. NO `created_by` column — use `updated_by` |
| `agent_feedback` | id, agent_name, type, message, created_at | Feedback (bug/idea/praise/general) |

Global vars: `window.__FORWARD_SUPABASE_URL`, `window.__FORWARD_SUPABASE_ANON_KEY`

For raw DELETE (supaRest.delete may 400 — use direct fetch instead):
```js
fetch(window.__FORWARD_SUPABASE_URL + '/rest/v1/table?filter=eq.value', {method:'DELETE',headers:{'apikey':window.__FORWARD_SUPABASE_ANON_KEY,'Authorization':'Bearer '+window.__FORWARD_SUPABASE_ANON_KEY,'Prefer':'return=representation'}})
```

### Listing Description
- Table: `property_notes` | Subfolder: `listing_remarks` | Column: `content`
- Saved by `ldSaveToProperty()` → `property_notes` + PDF to `property_assets`
- Voice generate queries: `&order=updated_at.desc&limit=1` (always gets newest)

---

## Design System (as of Chat 16–17 redesign)

### Colors
```css
--navy: #0A2342
--navy-mid: #1a3a5c
--gold: #C8A96E
--gold-muted: rgba(200,169,110,0.7)
--cream: #F7F4EF
--cream-mid: #E8E2D9
--cream-dark: #D4C9B8
--white: #FDFCFA
--ghost: rgba(10,35,66,0.35)
```

### Typography
- **Labels/headers:** Montserrat, 7.5–9px, font-weight:700, letter-spacing:0.14–0.22em, text-transform:uppercase
- **Body/content:** Cormorant Garamond, serif, 13–15px
- **NO Playfair Display** in new components — use Cormorant Garamond

### Shape
- **border-radius: 2px** everywhere — no rounded cards, no border-radius:10px/12px
- Hover states: border-color transitions to `var(--gold-muted)`

### CSS Classes (key)
- `.card` — white bg, cream-mid border, 2px radius, 20px padding
- `.lp-card` — tool grid cards: white bg, cream-mid border, 2px radius, Montserrat label, Cormorant sub
- `.lp-card:hover` — gold-muted border
- `.dash-tool-card` — dashboard tool cards
- `.listing-card` — seller property cards in grid
- `.camp-section-ta` — campaign textarea in section editor

---

## App Architecture

### Vue 3 Setup
- Single `setup()` returns all state + methods to template
- Every template function MUST be in `setup()` return
- `ref()` for primitives/arrays; `computed()` for derived

### Key State
- `agentName`, `propFiles`, `allAgentFiles`, `activePropFile`
- `byrBuyers`, `lstProperties`
- `campParsed` — array of `{title, content, included}` for campaign sections (loaded from localStorage)
- `campOpenSection` — ref(null), tracks which accordion section index is open
- `campShowPreview` — ref(false), controls campaign edit panel slide-over visibility
- `campGenerating` — ref(false), campaign generation in progress
- `campRevOpen` — ref(false), REMOVED from panel UI (left in JS state, unused in template)

### Key Functions
- `loadPropFiles()` — fetches 4 tables in parallel
- `go(view)` — switches view; triggers `loadPropFiles()` for 'prop-files'
- `lstFetchProperties()` / `byrFetchBuyers()` — admin sees all
- `ldSaveToProperty()` — saves text to `property_notes` + PDF to Drive
- `lstGenerateCampaignInApp()` — generates campaign package, populates campParsed
- `campApproveAndSend()` — sends approved campaign to seller
- `campCopyToClipboard()` — copies all sections to clipboard
- `inlineMicToggle(id, getter, setter)` — voice dictation for any field

---

## AGENTS & Admin
Team: Marc Cashin, Ashling McGowan, Niki Lang, Cesar Rivera, Charlotte Lee, Shannon Casey, Operations.
`ADMIN_AGENT` = 'Admin'. AGENTS array is correct — do NOT change.

---

## Upload System
- Files → `RAILWAY_URL + '/upload-file'` or `'/upload-buyer-file'`
- `_upload_ux` script wraps `window.fetch`, stores original as `const _f` (block-scoped). Shows "Keep screen on" banner + Wake Lock for uploads.
- ⚠️ NEVER wrap window.fetch again — already wrapped by _upload_ux. Double-wrapping breaks fetch permanently in that tab.

---

## Voice Modal — Write Content Tool

### Phases: `listening → parsing → confirm-write → answer`

### voiceModal.generate() flow
1. Fuzzy-match property via `_addrNorm()` (Rd/Road, St/Street, Ave/Avenue, Dr/Drive, Blvd/Boulevard + street-number fallback)
2. Fetch: `select=content&property_id=eq.{id}&subfolder=eq.listing_remarks&order=updated_at.desc&limit=1`
3. If none → "re-save the description for this property"
4. Build `_pd` → Anthropic API → set `voiceModal.answerText`

### Nav Pre-check
`/^(?:open(?!\s+house)|go to|take me to|show me|navigate to|pull up|bring up|switch to)\s+(.+)/i`
Negative lookahead prevents "open house for [address]" routing as navigation.

### Answer Phase
Full Training button hidden when `detectedTool === 'write-content'`.

---

## Campaign Package Panel (Seller Side)

### Structure
- **Left side:** campaign form (instructions, settings) + "Review & Edit Campaign Sections" button → opens panel
- **Right side:** `.camp-settings-panel` slide-over panel (fixed position overlay)

### Panel layout
1. **Navy header bar** — title + close button
2. **Scrollable section list** (`display:flex;flex-direction:column;overflow-y:auto;flex:1`) — each section card has `flex-shrink:0` (critical — prevents flex compression)
3. **Footer** — Approve & Send, Copy All, Close buttons

### Section card structure
Each `campParsed` item renders as:
```html
<div style="...flex-shrink:0">  <!-- CRITICAL: flex-shrink:0 -->
  <!-- Navy header bar — click to expand/collapse -->
  <div @click="campOpenSection = campOpenSection===idx ? null : idx" ...>
    <!-- pencil SVG, title (9px Montserrat uppercase cream), preview (13px Cormorant) -->
    <!-- Include checkbox + EDIT/CLOSE badge -->
  </div>
  <!-- Expanded textarea (v-if campOpenSection===idx) -->
  <div v-if="campOpenSection===idx">
    <textarea v-model="section.content" class="camp-section-ta" .../>
  </div>
</div>
```

### Removed: "Ask AI to Revise" accordion
Previously inside the panel between sections and footer. Removed in Chat 17 — direct editing is deterministic; AI revision adds error layers. The `campRevOpen` ref still exists in JS state but is no longer wired to any UI.

---

## Feedback System
- Gold gradient CTA → modal → `agent_feedback` table
- Digest: `netlify/functions/send-feedback-digest.js`, cron `0 22 * * *` (6pm ET)
- To: marc.cashin@corcoranmce.com via Resend
- Env vars: `RESEND_API_KEY`, `RESEND_FROM`, `SUPABASE_SERVICE_KEY` (all in Netlify)

---

## Chat History Summary

### Chat 9 (April 2026)
Client Files → Supabase. Resources bug fixed. View/Send buttons. GitHub App auth.

### Chat 10 (April 16)
Restored from outerHTML corruption. Removed Claude banner. Upload UX + Wake Lock. Agent-switch refresh.

### Chat 11 (April 17)
Voice write-content: Full Training hidden. Listing description from property_notes.

### Chat 12 (April 22)
Fixed $' injection bug. Feedback button gold CTA. Railway → Hobby plan.

### Chat 13 (April 22–23)
1. Gold feedback button — `a077cf1e`
2. Feedback digest + Resend domain — `d418a157`
3. Voice hint chips — `9aea8d73`
4. Fixed "open house" nav routing (negative lookahead) — `59179fe4`
5. Address fuzzy matching (_addrNorm) — `9605cd05`

### Chat 14 (April 23)
1. Fixed property_notes insert bug (invalid `created_by` field → silent 400) — `4409d117`
2. Voice generate query: added `&order=updated_at.desc&limit=1` — `be14a7a0`
3. Backfilled 19209 Croom Road description from Drive PDF into property_notes
4. Context file rebuilt (previous GitHub version was truncated)
5. Pitfall: never double-wrap window.fetch — use fresh tab if fetch breaks

### Chat 15 (April 23, 2026)
1. **Google Maps distance integration**: New Netlify function `get-nearby-places.js` calls Geocoding API + Places Nearby Search + Distance Matrix API server-side. Client-side `ldGetAmenityDistances()` calls the function and injects real driving distances into LD_SYSTEM as VERIFIED DISTANCE DATA. Updated instruction #7 to prohibit fabricated distances. Commits `2f855df2` (index.html), `259fb4f3` (new function).
2. **Env var required**: `GOOGLE_MAPS_PLACES_KEY` must be set in Netlify with a key that has Places API, Geocoding API, and Distance Matrix API enabled.
3. Pitfall: Browser fetch broken by prior session interceptors — opened fresh tab for all subsequent work.

### Chat 16 (May 2026) — Full UI Redesign
Complete visual overhaul of the app to a luxury real estate aesthetic.

**Design system established:**
- Colors: `--navy:#0A2342`, `--gold:#C8A96E`, `--cream:#F7F4EF`, `--cream-mid:#E8E2D9`
- Typography: Montserrat (labels, 7.5–9px, uppercase, tracked) + Cormorant Garamond (body/serif)
- Shape: `border-radius:2px` everywhere — no more rounded cards

**Components redesigned:**
1. **Dashboard** — stat-grid, voice-card (navy bg, animated mic rings), fub-card, two-col panels — `ef33ee5`
2. **Seller suite** — listings grid, property detail header with status badges, subfolder tools — `794dae3`
3. **Swipe-delete panel** — slim 52px strip, trash icon, muted red; z-index fix (card z:2 over panel z:1) — `d9ab49b`, `c64d4bf`
4. **Voice modal** — cream text on navy, animated wave bars, removed camera icon + training library block — `6811740`
5. **Seller tools section** — Montserrat headers, navy voice bar, campaign settings palette — `cdf771c`
6. **Campaign package panel** — complete redesign as slide-over with accordion sections — `c4f1508`–`f357fe2`

**Key bugs fixed:**
- White screen: invalid Vue `:style` object `{fontFamily:'Montserrat',sans-serif}` (bare key) — fixed by splitting static/dynamic style attrs — `119abc2`
- Campaign section bars collapsing to thin lines: root cause was `flex-shrink` on children of `display:flex;flex-direction:column` scroll container — fixed with `flex-shrink:0` — `f357fe2`
- Desktop showing mobile nav bar — added `display:none` + `@media(max-width:768px)` for `.mobile-nav`

### Chat 17 (May 2026) — Campaign cleanup + Buyer side styling
1. **Removed "Ask AI to Revise" accordion** from campaign panel — direct editing is cleaner, AI revision adds unnecessary error layers — `a008c93`
2. **Buyer side full restyle**: added `.lp-card`/`.lp-icon`/`.lp-label`/`.lp-sub`/`.lp-card-mobile`/`.lp-arrow` CSS; voice banner, Client Files cards, upload buttons, Offer Tracker header/form/rows all updated to cream/navy/gold aesthetic with 2px radius — `ddba209`

### Chat 18 (May 4, 2026) — BMR: UAD methodology, market conditions, comp quality gates

#### What is the BMR?
The Buyer Market Report is a 4-step tool in FORWARD OS:
1. Upload MLS Agent Full PDF → Claude extracts comps as JSON
2. Agent reviews/edits extracted comp data, sets market conditions, regenerates narrative
3. Enter offer details (client name, offer price, terms)
4. Deploy as a live Netlify site (forward-XXXX.netlify.app)

#### Backend (Railway — `marccashin/forward-command-center`, `backend/main.py`)
All BMR logic lives here. Current HEAD: `9bd351a`

**Key constants:**
```python
UAD = {"gla_per_sqft": 50, "bedroom": 15_000, "full_bath": 12_000, "half_bath": 5_000, "garage": 20_000,
       "condition": {"A+": 15_000, "A": 10_000, "B": 5_000, "C": 0, "D": -10_000}}

MARKET_COND_ADJ   = {"low": -0.03, "balanced": 0.00, "competitive": 0.03, "high": 0.06, "war": 0.10}
MARKET_COND_LABEL = {"low": "Slow / Buyer Favored", "balanced": "Balanced Market",
                     "competitive": "Competitive", "high": "Very Competitive",
                     "war": "Bidding War / Multiple Offers"}
MARKET_LIST_FLOOR = {"low": None, "balanced": 0.94, "competitive": 0.97, "high": 0.99, "war": 1.01}
# Floor = minimum winning offer as fraction of list price. Never recommend more than this % below ask.

MAX_NET_ADJ_PCT = 0.15  # Exclude comp from average if |net_adj| > 15% of its sale price
MAX_GLA_PCT     = 0.15  # Flag (warn) if GLA adjustment alone > 15% of sale price
```

**`_dom_adj(dom)`** — adjustment % based on subject days on market:
- 0 days → 0%, 1–7 → +2%, 8–21 → +1%, 22–45 → 0%, 46–90 → -2%, 90+ → -4%

**`_uad_calc(analysis)`** — deterministic Python UAD math:
- Runs on CLOSED comps only
- Calculates GLA adj ($50/sqft × sqft diff), bed adj ($15k), bath adj ($12k/$5k)
- Excludes comps where |net_adj| > 15% of sale price from the average
- If exclusions leave < 2 comps, uses all (fallback mode, warns)
- Returns: `avg_adjusted`, `supported_value_str`, `offer_range_str`, `detail_text`,
  `quality_warnings` (list), `n_excluded`, `pct_diff`, `above_below`, `list_price`, `n_comps`

**`_bmr_build_html(req)`** — builds the deployed report HTML:
- Calls `_uad_calc()` then applies market conditions + DOM adjustment
- Applies list-price floor: `win_offer = max(uad_win, list_price × MARKET_LIST_FLOOR[mc_key])`
- Shows yellow floor-applied note when floor overrides raw UAD number
- `py_market_box` = 3-column card: UAD Supported Value | Market Conditions | Market Adjustment $

**`/api/buyer-report/regenerate`** endpoint:
- Accepts: `subject`, `comps`, `market_conditions`, `subject_dom`
- Python does ALL math; Claude only writes narrative + offer_summary text
- Returns: `narrative`, `offer_summary`, `offer_guidance` (full detail incl. market-adjusted result),
  `supported_value`, `offer_range`, `suggested_offer_price`, `quality_warnings`, `n_excluded`
- `offer_guidance` returned to Step 2 includes: raw UAD comp detail + market conditions applied +
  `✓ ESTIMATED WINNING OFFER: $XXX,XXX` line at bottom

**`/api/buyer-report/analyze`** endpoint:
- Accepts PDF, sends to Claude, extracts comp JSON
- Also runs `_uad_calc()` and attaches `quality_warnings` + `n_excluded` to response

**Pydantic models (all optional fields have defaults — required fields come first):**
```python
class BuyerReportDeployRequest(BaseModel):
    analysis: BuyerReportAnalysis
    offer_price: str; offer_terms: list[str]; client_name: str
    agent_name: str; agent_email: str; agent_phone: str; report_title: str
    market_conditions: str = "balanced"
    subject_dom: int = 0
```

#### Frontend (Netlify — `marccashin/forward-os`, `index.html`)
Current HEAD: `3bf2560`

**Key refs added:**
```javascript
bmrMarketConditions = ref('balanced')  // market conditions key
bmrSubjectDom       = ref('')          // subject days on market
bmrQualityWarnings  = ref([])          // list of warning strings from backend
bmrNExcluded        = ref(0)           // count of excluded comps
bmrLastRegen        = ref('')          // timestamp of last successful regenerate (HH:MM:SS)
```

**Step 2 layout (top to bottom):**
1. Yellow "Verify Extracted Data Before Proceeding" banner (always shown)
   - If `bmrNExcluded > 0`: shows single-line count "N comps are too dissimilar..."
2. Subject property card (editable fields)
3. Comp cards (editable, each with ✕ to remove)
4. Market Conditions grid (2 cols): dropdown + Subject DOM input ← MOVED HERE from Step 3
5. Market Narrative header + Regenerate button + green ✓ Updated HH:MM:SS badge
6. Narrative textarea
7. Offer Guidance textarea (shows market-adjusted offer after regenerate)

**Step 3:** Client name, offer price, report title, offer terms (market conditions removed from here)

**Regenerate JS uses `Object.assign({}, bmrAnalysis.value, {...})` to force Vue reactivity on update.**

#### Common Pitfalls (BMR-specific)
- Railway sandbox proxy blocks `railway.app` — can never verify Railway health from Cowork shell. HTTP 000 always means proxy block, not Railway down.
- Python 3.11 f-string restriction: can't use same quote type inside expression as outer f-string. Use single-quoted outer f-strings with double-quoted inner dict keys.
- Pydantic v2 on Railway — required fields (no default) must come BEFORE optional fields (with defaults) in model class body.
- Claude temperature=0 on regenerate → deterministic output, may look unchanged if same comps. Green timestamp badge confirms it ran.
- `offer_guidance` textarea in Step 2 = detailed UAD + market adjustment text. `narrative` textarea = Claude-written prose.


---

## Common Pitfalls

1. **Template function invisible?** → Not in `setup()` return.
2. **Raw `{{ }}` on screen?** → Literal newline in JS string. Use `\n`.
3. **localStorage** → Old approach. All data in Supabase.
4. **Never paste GitHub tokens** — auto-revoked. Use PAT in git remote URL for Cowork shell sessions.
5. **Supabase `.catch(()=>[])`** — intentional graceful fallback.
6. **Never push outerHTML** — always push fetched source.
7. **Async fetch timing** — verify length in separate tool call.
8. **Never use `.replace()` for JS patches** — `$'` hazard. Use Python `str.replace()` in scripts (safe).
9. **GitHub rate limiting** — one get-sha call per file right before push.
10. **Security filter** — use raw.githubusercontent.com; use structural indexOf searches not large reads.
11. **`property_notes` no `created_by` column** — use `updated_by`. Wrong column = silent 400.
12. **Context file corruption** — if truncated in GitHub, rebuild from uploaded copy.
13. **Never double-wrap window.fetch** — `_upload_ux` already wraps it. If fetch breaks, open a fresh tab.
14. **`supaRest.delete` may 400** — use direct `fetch()` DELETE to Supabase REST URL instead.
15. **Between-call async**: Network I/O callbacks only complete with user interaction gaps between tool calls.
16. **Vue `:style` object syntax** — never use bare unquoted keys like `{fontFamily:'Montserrat',sans-serif}`. Either quote as a string `"font-family:'Montserrat',sans-serif"` or split into static `style=""` + dynamic `:style="{}"`.
17. **Campaign section bars collapsing** — section cards inside `display:flex;flex-direction:column` scroll containers are flex children and will shrink. Always add `flex-shrink:0` to section card divs.
18. **BMR comp exclusions too aggressive** — threshold is percentage-based (15% of sale price), not fixed dollar. In a $700k market, a $30k threshold excludes too many comps.
19. **BMR market conditions floor** — in Very Competitive/Bidding War markets, the winning offer is floored at 99–101% of list price even if UAD comps support less. This is intentional.
20. **Railway deploy timing** — after pushing to GitHub, Railway takes ~2–3 min to rebuild Docker. Netlify takes ~30 sec. Don't test immediately after push.
