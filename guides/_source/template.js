// HTML/CSS template for "FORWARD: If This, Then That".
// All measurements were taken from the original PDF (orig/guide.pdf) with pdfplumber:
// 1pt = 4/3 px. Fractional px values (9.75px, 51.25px, 6.5px, 5.5px, 9.25px, 15.75px, the .25px nudges)
// were fitted so that Chromium snaps every line and box to the same device pixel as the original.
// The footer uses Chromium's default sans-serif, which on this machine is the system Inter (as in the original).
'use strict';
const path = require('path');

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Fonts are loaded from npm packages (@fontsource) installed in FONT_DIR (see README).
// The original PDF names its body font MontserratThin-Regular/-SemiBold/-Bold: that is how the
// static @fontsource/montserrat files name themselves, so the static 400/600/700 files are used.
// No italic file is loaded: the original's italic is Chromium's synthesized oblique.
function fontFaces(fontDir) {
  const f = (p) => 'file://' + path.join(fontDir, p);
  return `
@font-face{font-family:'Cormorant Garamond';font-weight:600;font-style:normal;
  src:url('${f('@fontsource/cormorant-garamond/files/cormorant-garamond-latin-600-normal.woff2')}') format('woff2');}
@font-face{font-family:'Montserrat';font-weight:400;font-style:normal;
  src:url('${f('@fontsource/montserrat/files/montserrat-latin-400-normal.woff2')}') format('woff2');}
@font-face{font-family:'Montserrat';font-weight:600;font-style:normal;
  src:url('${f('@fontsource/montserrat/files/montserrat-latin-600-normal.woff2')}') format('woff2');}
@font-face{font-family:'Montserrat';font-weight:700;font-style:normal;
  src:url('${f('@fontsource/montserrat/files/montserrat-latin-700-normal.woff2')}') format('woff2');}
@font-face{font-family:'Montserrat Stray';font-weight:400;font-style:normal;
  src:url('${f('@fontsource-variable/montserrat/files/montserrat-latin-wght-normal.woff2')}') format('woff2-variations');}
`;
}

const CSS = `
:root{
  --navy:#0A2342;          /* (0.0392,0.1373,0.2588) */
  --gold:#C8A96E;          /* (0.7843,0.6627,0.4314) */
  --brown:#7A6340;         /* small caps kicker labels */
  --cream:#F7F4EF;         /* header text + automatic band */
  --you:#FFF8EA;           /* YOU column + callout */
  --line:#DDD9D0;          /* box borders */
  --sep:#EDEAE3;           /* column separators, contact rule */
  --muted:#5C5A55;         /* section intros, notes, footnote */
  --none:#6B6862;          /* "Nothing for ..." */
  --go:#3D3B37;            /* team card "go here for" text */
}
@page{size:Letter;margin:0.55in;}
*{box-sizing:border-box;margin:0;padding:0;}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
body{font-family:'Montserrat';font-weight:400;color:var(--navy);font-size:8.6pt;line-height:1.38;}
/* .stray: text the October 17 PDF shows in a different font (it was edited into the PDF after printing).
   Kept only so the rebuild matches that PDF; content.js marks it with strayFont: true. */
.stray{font-family:'Montserrat Stray';font-weight:400;}

/* ---------- page 1 ---------- */
.hero{background:var(--navy);border-radius:8px;padding:21px 26px 20px;color:var(--cream);}
.hero .brand{font-family:'Cormorant Garamond';font-weight:600;font-size:15pt;letter-spacing:.14em;line-height:1.2;}
.hero h1{font-family:'Cormorant Garamond';font-weight:600;font-size:30pt;line-height:1.15;margin-top:11px;}
.hero p{font-size:9.5pt;line-height:1.38;color:rgba(247,244,239,.86);max-width:560px;margin-top:6px;}

.callout{margin-top:12px;background:var(--you);border:2px solid var(--gold);border-radius:8px;padding:12px 18px 13px;}
.callout .label{font-size:7.6pt;font-weight:700;color:var(--brown);letter-spacing:.14em;line-height:1.3;}
.callout h2{font-family:'Cormorant Garamond';font-weight:600;font-size:19pt;line-height:1.15;margin-top:4px;}
.callout p{font-size:9.2pt;line-height:1.38;margin-top:5.5px;}

.teams{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px;}
.team{border:1px solid var(--line);border-top:4px solid var(--navy);border-radius:8px;padding:12px 16px 10px;display:flex;flex-direction:column;}
.team .kicker{font-size:6.8pt;font-weight:700;color:var(--brown);letter-spacing:.12em;line-height:1.3;}
.team h3{font-family:'Cormorant Garamond';font-weight:600;font-size:19pt;line-height:1.2;margin-top:0;}
.team .text{font-size:9.4pt;line-height:1.4;margin-top:6px;}
.team .go-label{font-size:6.8pt;font-weight:700;letter-spacing:.12em;line-height:1.3;margin-top:9px;}
.team .go-text{font-size:8.6pt;line-height:1.38;color:var(--go);margin-top:2px;margin-bottom:9.25px;}
.team .contact{margin-top:auto;border-top:1px solid var(--sep);padding-top:7px;font-size:8pt;line-height:1.38;color:var(--muted);}

h2.sec{font-family:'Cormorant Garamond';font-weight:600;font-size:20pt;line-height:1.2;margin-top:16px;padding-bottom:7px;border-bottom:2px solid var(--gold);}
p.secintro{font-size:8.6pt;line-height:1.38;color:var(--muted);margin-top:6px;}

.flow{border:1px solid var(--line);border-radius:8px;padding:12px 14px 12px;margin-top:10px;}
.flow + .flow{margin-top:10px;}
.flow .label{font-size:7pt;font-weight:700;color:var(--brown);letter-spacing:.14em;line-height:1.3;}
.pills{display:flex;flex-wrap:wrap;align-items:center;column-gap:4px;row-gap:6px;margin-top:9px;}
.pill{background:var(--navy);color:var(--cream);font-size:7.8pt;font-weight:600;border-radius:999px;height:22px;line-height:22px;padding:0 10px;white-space:nowrap;}
.arrow{color:var(--gold);font-weight:700;font-size:11pt;line-height:22px;padding:0;position:relative;top:-.25px;}
.flow .note{font-size:7.6pt;line-height:1.38;color:var(--muted);margin-top:8px;}

/* ---------- stage sections ---------- */
.section{break-before:page;}
.stage{border:1px solid var(--line);border-radius:8px;overflow:hidden;margin-top:10px;break-inside:avoid;}
.section > h2.sec + p.secintro + .stage{margin-top:9.75px;}
.stage.newpage{break-before:page;margin-top:0;}
.stage-head{background:var(--navy);color:var(--cream);height:51.25px;display:flex;align-items:center;padding:0 12px;}
.stage-num{position:relative;top:.25px;margin-top:-.5px;flex:none;width:22px;height:22px;border-radius:50%;background:var(--gold);color:var(--navy);font-size:8.5pt;font-weight:700;display:flex;align-items:center;justify-content:center;line-height:1;}
.stage-titles{margin-left:10px;position:relative;top:-.25px;}
.stage-title{font-family:'Cormorant Garamond';font-weight:600;font-size:14pt;line-height:1.1;}
.stage-trigger{font-size:8pt;line-height:1.3;color:rgba(247,244,239,.82);}
.auto{background:var(--cream);padding:6.5px 12px 6px;}
.lbl{font-size:7pt;font-weight:700;letter-spacing:.12em;line-height:1.3;}
ul.b{list-style:none;margin-top:3px;}
ul.b li{position:relative;padding-left:13px;margin-bottom:1px;}
ul.b li::before{content:'';position:absolute;left:-1px;top:6px;width:4px;height:4px;border-radius:50%;background:var(--navy);}
.cols{display:grid;grid-template-columns:1.25fr 1fr 1fr;}
.col{padding:7px 12px 6px;}
.col + .col{border-left:1px solid var(--sep);}
.col.you{background:var(--you);}
.none{color:var(--none);font-style:italic;margin-top:3px;}

/* ---------- also automatic ---------- */
.also h2.sec{margin-top:15.75px;}
table.also-t{width:100%;border-collapse:collapse;margin-top:8px;}
table.also-t td{border-top:1px solid var(--line);padding:7px 8px 7px;vertical-align:top;font-size:8.6pt;line-height:1.38;}
table.also-t td.when{font-weight:700;white-space:nowrap;}
.footnote{font-size:7.4pt;line-height:1.38;color:var(--muted);margin-top:10px;}
`;

function bullets(items) {
  const out = [];
  let ul = [];
  const flush = () => { if (ul.length) { out.push('<ul class="b">' + ul.join('') + '</ul>'); ul = []; } };
  for (const it of items) {
    const t = it.strayFont ? `<span class="stray">${esc(it.text)}</span>` : esc(it.text);
    if (it.none) { flush(); out.push(`<p class="none">${t}</p>`); }
    else ul.push(`<li>${t}</li>`);
  }
  flush();
  return out.join('');
}

function stage(s, newPage) {
  return `
<div class="stage${newPage ? ' newpage' : ''}" data-stage="${s.num}" data-page="${s.page}">
  <div class="stage-head"><div class="stage-num">${s.num}</div>
    <div class="stage-titles"><div class="stage-title">${esc(s.title)}</div><div class="stage-trigger">${esc(s.trigger)}</div></div></div>
  <div class="auto"><div class="lbl">HAPPENS AUTOMATICALLY</div>${bullets(s.automatic)}</div>
  <div class="cols">
    <div class="col you"><div class="lbl">YOU</div>${bullets(s.you)}</div>
    <div class="col"><div class="lbl">CONCIERGE</div>${bullets(s.concierge)}</div>
    <div class="col"><div class="lbl">TRANSACTIONS</div>${bullets(s.transactions)}</div>
  </div>
</div>`;
}

function render(c, opts) {
  const fontDir = opts.fontDir;
  const cv = c.cover;
  const team = (t) => `
  <div class="team"><div class="kicker">${esc(t.kicker)}</div><h3>${esc(t.name)}</h3><div class="text">${esc(t.text)}</div>
    <div class="go-label">${esc(t.goLabel)}</div><div class="go-text">${esc(t.goText)}</div>
    <div class="contact">${esc(t.contact)}</div></div>`;
  const flow = (f) => {
    const pills = f.stages.map((s, i) => `<span class="pill">${esc(s)}</span>` + (i < f.stages.length - 1 ? '<span class="arrow">›</span>' : '')).join('');
    return `<div class="flow"><div class="label">${esc(f.label)}</div><div class="pills">${pills}</div>${f.note ? `<div class="note">${esc(f.note)}</div>` : ''}</div>`;
  };
  let lastPage = 1;
  const sections = c.sections.map((sec) => {
    const firstPage = sec.stages[0].page;
    lastPage = firstPage;
    const st = sec.stages.map((s, i) => {
      const np = i > 0 && s.page !== lastPage;
      lastPage = s.page;
      return stage(s, np);
    }).join('');
    return `<div class="section"><h2 class="sec">${esc(sec.title)}</h2><p class="secintro">${esc(sec.intro)}</p>${st}</div>`;
  }).join('');
  const fn = c.also.footnote;
  const dateCls = fn.dateStrayFont ? ' class="stray"' : '';
  const rows = c.also.rows.map((r) => `<tr><td class="when">${esc(r.when)}</td><td class="who">${esc(r.who)}</td><td class="what">${esc(r.what)}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(c.docTitle)}</title>
<style>${fontFaces(fontDir)}${CSS}${opts.extraCss || ''}</style></head><body>
<div class="page1">
  <div class="hero"><div class="brand">${esc(cv.brand)}</div><h1>${esc(cv.title)}</h1><p>${esc(cv.intro)}</p></div>
  <div class="callout"><div class="label">${esc(cv.callout.label)}</div><h2>${esc(cv.callout.heading)}</h2><p>${esc(cv.callout.text)}</p></div>
  <div class="teams">${cv.teams.map(team).join('')}</div>
  <h2 class="sec">${esc(c.glance.title)}</h2><p class="secintro">${esc(c.glance.sub)}</p>
  ${c.glance.flows.map(flow).join('')}
</div>
${sections}
<div class="also"><h2 class="sec">${esc(c.also.title)}</h2>
  <table class="also-t">${rows}</table>
  <p class="footnote">${esc(fn.before)}<span${dateCls}>${esc(fn.date)}</span>${esc(fn.after)}</p>
</div>
</body></html>`;
}

function footerTemplate(c) {
  return `<div style="width:100%;font-size:7px;color:#5C5A55;padding:0 0.55in;display:flex;justify-content:space-between;">
<span>${esc(c.footer)}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;
}

module.exports = { render, footerTemplate };
