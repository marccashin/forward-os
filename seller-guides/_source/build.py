#!/usr/bin/env python3
"""Build the FORWARD Seller Guide (two-page seller one-sheet) for each agent.

Usage:  python3 build.py [slug ...]        (no slug = every agent in agents.json)

Needs Python Playwright with Chromium. Fonts and images are read from ./assets.
Output: ../<First>_<Last>_Seller_Guide.pdf  (one folder up, where the app links to)

The layout reproduces Charlotte Lee's approved Seller Guide of 2026-09-29.
Only the agent block changes between agents: name, photo, bio, phone, email,
testimonial(s), the closing line and the footers. Everything else is shared copy.
"""
import html, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, 'assets')
OUT = os.path.abspath(os.path.join(HERE, '..'))


def e(s):
    return html.escape(s, quote=False)


CSS = """
@font-face{font-family:'Lora';font-weight:400;font-style:normal;src:url('assets/lora-400.woff2') format('woff2');}
@font-face{font-family:'Poppins';font-weight:300;font-style:normal;src:url('assets/poppins-300.woff2') format('woff2');}
@font-face{font-family:'Poppins';font-weight:300;font-style:italic;src:url('assets/poppins-300i.woff2') format('woff2');}
@font-face{font-family:'Poppins';font-weight:500;font-style:normal;src:url('assets/poppins-500.woff2') format('woff2');}
@page{size:612pt 792pt;margin:0;}
*{box-sizing:border-box;margin:0;padding:0;}
html,body{background:#fdfbf7;}
body{font-family:'Poppins',sans-serif;font-weight:300;color:#1b1b2e;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.page{position:relative;width:612pt;height:792pt;overflow:hidden;background:#fdfbf7;page-break-after:always;}
.page:last-child{page-break-after:auto;}
.pad{padding:0 43.3pt;}
.serif{font-family:'Lora',serif;font-weight:400;color:#000033;}
.rule{border:0;border-top:0.75pt solid #d6d3c8;margin:0 43.3pt;}
h2{font-family:'Lora',serif;font-weight:400;color:#000033;font-size:15.3pt;line-height:20pt;}
h3{font-family:'Lora',serif;font-weight:400;color:#000033;font-size:11.3pt;line-height:14.5pt;}

/* page 1 */
.hdr{position:absolute;left:0;top:0;width:612pt;height:126pt;background:#000033;}
.hdr img{position:absolute;left:43.3pt;top:19.5pt;width:123pt;}
.hdr .t{position:absolute;left:43.3pt;top:62pt;font-family:'Lora',serif;font-size:22pt;line-height:30pt;color:#fff;}
.hdr .s{position:absolute;left:43.3pt;top:94.5pt;font-size:10pt;line-height:14pt;color:#c9c9dc;}
.intro{position:absolute;left:43.3pt;right:43.3pt;top:141.3pt;font-size:9.7pt;line-height:14pt;}
.r1{position:absolute;left:0;right:0;top:176.5pt;}
.adv{position:absolute;left:43.3pt;right:43.3pt;top:185pt;}
.adv .ph{position:absolute;left:0;top:0;width:105pt;height:172pt;object-fit:cover;}
.adv .tx{margin-left:122pt;min-height:172pt;}
.adv .tx p{font-size:8.9pt;line-height:12.75pt;margin-top:3.9pt;}
.adv .tx p:first-of-type{margin-top:4pt;}
.adv .ct{margin-top:6pt;line-height:16pt;}
.adv .ct .ph1{font-family:'Lora',serif;font-size:13.5pt;color:#000033;margin-right:3pt;}
.adv .ct .em{font-size:9.33pt;color:#444459;}
.flow{position:absolute;left:0;right:0;}
.sec{padding:9pt 43.3pt 0;}
.g2{display:grid;grid-template-columns:1fr 1fr;column-gap:20pt;}
.exp{margin-top:4pt;row-gap:4.2pt;}
.exp p{font-size:9pt;line-height:12.4pt;margin-top:0;}
.q{margin-top:4pt;column-gap:10pt;}
.q.one{grid-template-columns:1fr;}
.q.one .qb{padding:13pt 16pt 14pt;font-size:10pt;line-height:15.6pt;}
.q.one .qb .by{font-size:9.33pt;margin-top:6pt;}
.qb{background:#f1eee6;padding:7.5pt 10.7pt 9pt;font-size:8.67pt;line-height:12pt;}
.qb .by{font-weight:500;color:#000033;margin-top:3.2pt;}
.qb .bn{font-weight:300;color:#54546a;}
.ftr{position:absolute;left:0;bottom:0;width:612pt;height:44pt;background:#000033;}
.ftr img{position:absolute;left:43.3pt;top:11.5pt;width:86pt;}
.ftr .x{position:absolute;right:43.3pt;top:14pt;font-size:9.33pt;line-height:14pt;color:#fff;white-space:pre;}

/* page 2 */
.lab{font-weight:500;font-size:7.33pt;letter-spacing:0.22em;text-transform:uppercase;color:#6a6a80;line-height:10pt;}
.p2{position:absolute;left:43.3pt;right:43.3pt;top:26pt;}
.p2 h1{font-family:'Lora',serif;font-weight:400;color:#000033;font-size:18.7pt;line-height:24pt;margin-top:3pt;}
.p2 .lead{font-size:9.7pt;line-height:14.2pt;margin-top:6.5pt;}
.av{display:grid;grid-template-columns:258pt 1fr;column-gap:13.4pt;margin-top:7pt;}
.av .hd{font-weight:500;font-size:9.7pt;line-height:14pt;color:#000033;}
.av ul{list-style:none;margin-top:1.5pt;}
.av li{position:relative;padding-left:11.4pt;font-size:9.33pt;line-height:12.9pt;margin-top:1.2pt;}
.av li:before{content:'';position:absolute;left:1.8pt;top:5.1pt;width:2.8pt;height:2.8pt;border-radius:50%;background:#1b1b2e;}
.box{background:#000033;color:#fff;padding:6.5pt 12pt 10pt;height:113pt;}
.box .lab{color:#b9b9d5;}
.box p{font-size:9.2pt;line-height:13.2pt;margin-top:2pt;}
.st4{margin-top:4pt;row-gap:6pt;column-gap:14.5pt;}
.st4 h3 .n{font-size:10pt;}
.st4 p{font-size:9.2pt;line-height:12.6pt;}
.who{font-size:8.67pt;line-height:12.6pt;color:#54546a;margin-top:6pt;}
.who b{font-weight:500;color:#000033;}
.p2 .rule2{border:0;border-top:0.75pt solid #d6d3c8;margin-top:8.5pt;}
.p2 h2{margin-top:9pt;}
.steps{margin-top:3pt;column-gap:14.5pt;row-gap:3pt;}
.step{position:relative;padding-left:25.4pt;}
.step .c{position:absolute;left:0;top:5pt;width:16pt;height:16pt;border-radius:50%;background:#000033;color:#fff;font-family:'Lora',serif;font-size:8pt;line-height:16pt;text-align:center;}
.step h4{font-family:'Lora',serif;font-weight:400;color:#000033;font-size:10.67pt;line-height:14pt;}
.step p{font-size:8.9pt;line-height:12.2pt;}
.team{font-size:9.33pt;line-height:13.4pt;margin-top:6.5pt;}
.team b{font-weight:500;color:#000033;}
.cta{font-family:'Lora',serif;color:#000033;font-size:12.67pt;line-height:18.7pt;margin-top:6.5pt;}
"""

EXPECT = [
    ("You stay in control", "You will always know where things stand, what your options are, and how each decision affects your bottom line. Nothing moves forward without you."),
    ("Clear, regular reporting", "Our Seller Performance Dashboard gives you recurring reports on online views, marketing reach, showing feedback, agent interest, and nearby competition."),
    ("One team handles the details", "Our team coordinates inspections, appraisals, paperwork, and deadlines, so you are not juggling it all."),
    ("Honest advice", "We will tell you what is worth fixing, what is not, and how to price your home to attract the most qualified buyers."),
]
AVATAR = [
    "Your home's features, size, and price",
    "Neighborhood data: schools, transit, walkability, development plans",
    "Market trends and buyer behavior for your zip code",
    "The income and likely professions needed to buy at your price",
    "Who has actually bought similar homes nearby",
]
FOUR = [
    ("1.", "Match your home to the right buyer", "Every home has a natural match. Walkability and Metro access draw government and policy buyers; low-maintenance living appeals to downsizers."),
    ("2.", "Reach them where they are", "Targeted online ads, international relocation networks, print mailers, neighborhood newsletters, and agents who represent those buyers."),
    ("3.", "Speak their language", "Each avatar gets its own message. When buyers feel a home fits their life, they act faster."),
    ("4.", "Stay in front of them", "Video, a listing film, targeted emails, and follow-up ads keep your home top of mind until they book a showing."),
]
# Printed left column 1-4, right column 5-8; laid out row by row as 1,5,2,6,3,7,4,8.
STEPS = [
    ("Consultation and agreements", "We learn your goals and timing, walk the property, and sign the listing agreement when you are ready."),
    ("Strategic pricing", "Based on comparable sales, absorption rates, and your desired net proceeds, priced to reach the most qualified buyers. Price also guides how much to invest in preparation."),
    ("Preparation plan", "Recommended repairs and touch-ups worth making, decluttering guidance, and staging or virtual staging where it adds value."),
    ("Media and pre-launch review", "Professional photography, video, and floor plans, then a pre-launch review meeting with you."),
    ("Broker's open", "Before your home goes live, we invite top local agents for an exclusive preview so they can bring their buyers on day one."),
    ("Launch and showings", "Marketing goes live with a public open house the first weekend. Feedback and dashboard reports follow, and we adjust if needed."),
    ("Offers and negotiation", "We review every offer together and negotiate price, contingencies, and timeline until it is ratified."),
    ("Contract to close", "Contingencies, repairs, and financing managed; final walkthrough, closing, and distribution of funds."),
]


def page_html(a):
    bio = ''.join('<p>' + e(p) + '</p>' for p in a['bio'])
    quotes = ''
    for q in a['quotes']:
        note = ('<span class="bn">, ' + e(q['by_note']) + '</span>') if q.get('by_note') else ''
        quotes += '<div class="qb">"' + e(q['text']) + '"<div class="by">' + e(q['by']) + note + '</div></div>'
    qcls = 'g2 q' + (' one' if len(a['quotes']) == 1 else '')
    expect = ''.join('<div><h3>' + e(t) + '</h3><p>' + e(b) + '</p></div>' for t, b in EXPECT)
    avatar = ''.join('<li>' + e(x) + '</li>' for x in AVATAR)
    four = ''.join('<div><h3><span class="n">' + n + '</span> ' + e(t) + '</h3><p>' + e(b) + '</p></div>' for n, t, b in FOUR)
    order = [0, 4, 1, 5, 2, 6, 3, 7]
    steps = ''.join('<div class="step"><div class="c">' + str(i + 1) + '</div><h4>' + e(STEPS[i][0]) + '</h4><p>' + e(STEPS[i][1]) + '</p></div>' for i in order)
    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>' + e(a['name']) + ' | Selling Your Home</title><style>' + CSS + '</style></head><body>'
        # ---------- page 1
        '<div class="page">'
        '<div class="hdr"><img src="assets/logo-white.png" alt=""><div class="t">Selling Your Home</div>'
        '<div class="s">A clear, personal guide to what happens, when, and who will be with you</div></div>'
        '<div class="intro">Whether you are selling a longtime residence or an investment property, our goal is the same: a smooth process, honest advice, and the strongest possible return on your property, with no surprises along the way.</div>'
        '<div class="r1"><hr class="rule"></div>'
        '<div class="adv" id="adv"><img class="ph" src="assets/' + a['slug'] + '.jpg" style="object-position:' + a.get('photo_position', '50% 50%') + '" alt="">'
        '<div class="tx"><h2>Your Advisor: ' + e(a['name']) + '</h2>' + bio +
        '<div class="ct"><span class="ph1">' + e(a['phone']) + '</span> <span class="em">' + e(a['email']) + '</span></div></div></div>'
        '<div class="flow" id="flow"><hr class="rule">'
        '<div class="sec"><h2>What You Can Expect From Us</h2><div class="g2 exp">' + expect + '</div></div>'
        '<hr class="rule" style="margin-top:7pt">'
        '<div class="sec"><h2>' + e(a['quotes_heading']) + '</h2><div class="' + qcls + '">' + quotes + '</div></div>'
        '</div>'
        '<div class="ftr"><img src="assets/logo-white.png" alt=""><div class="x">' + e(a['name']) + '  |  ' + e(a['phone']) + '</div></div>'
        '</div>'
        # ---------- page 2
        '<div class="page"><div class="p2">'
        '<div class="lab">What sets us apart</div>'
        '<h1>We Build Your Buyer Before We Market Your Home</h1>'
        '<p class="lead">Most listings are marketed to everyone. Ours are marketed to the right someone. Before your home goes live, we build detailed buyer avatars: profiles of the real people most likely to compete for your property. Then we speak directly to them, in the places they already spend their time.</p>'
        '<div class="av"><div><div class="hd">Every buyer avatar is built from</div><ul>' + avatar + '</ul></div>'
        '<div class="box"><div class="lab">Nothing is guessed</div><p>Gaps are filled only when data is verifiable. These avatars are not fictional. They mirror the real categories of buyers most likely to make an offer on your home, so every photo, word, and ad is aimed at them.</p></div></div>'
        '<div class="g2 st4">' + four + '</div>'
        '<p class="who"><b>Who is buying today:</b> Baby Boomers are now the largest share of buyers, 26% of buyers paid all cash (a record high), and most buyers decide after seeing just 7 to 8 homes. <i>Source: NAR</i></p>'
        '<hr class="rule2">'
        '<h2>The Process, Step by Step</h2><div class="g2 steps">' + steps + '</div>'
        '<hr class="rule2">'
        '<p class="team"><b>A full team behind you:</b> transaction management, client concierge, financial strategy, market intelligence, trusted attorneys, and in-house photography. &nbsp;<b>$280M+</b> team sales &nbsp;|&nbsp; <b>300+</b> transactions &nbsp;|&nbsp; <b>97%</b> contract-to-close</p>'
        '<p class="cta">The first step is simply a conversation. Contact ' + e(a['first']) + ' to arrange a visit that works for you.</p>'
        '</div>'
        '<div class="ftr"><img src="assets/logo-white.png" alt=""><div class="x">' + e(a['name']) + '  |  ' + e(a['phone']) + '  |  ' + e(a['email']) + '</div></div>'
        '</div></body></html>'
    )


# Places the lower half of page 1 under the advisor block (bios differ in length)
# and reports the free space left above the footer so an overflow is caught, not clipped.
PLACE_JS = """() => {
  const pt = 0.75;
  const adv = document.getElementById('adv'), flow = document.getElementById('flow');
  const top = adv.offsetTop + adv.offsetHeight + 5 / pt;
  flow.style.top = (top * pt) + 'pt';
  const page = document.querySelector('.page');
  const free = () => (page.offsetHeight - 44 / pt - (flow.offsetTop + flow.offsetHeight)) * pt;
  // A short bio or a single testimonial leaves the page bottom-light: open up the
  // three section gaps evenly (at most 13pt each) instead of leaving one empty band.
  const spare = free() - 24;
  if (spare > 0) {
    const add = Math.min(13, spare / 3);
    flow.style.top = (top * pt + add) + 'pt';
    flow.querySelectorAll('.sec').forEach(s => { s.style.paddingTop = (9 + add / 2) + 'pt'; });
    flow.querySelectorAll('hr')[1].style.marginTop = (7 + add) + 'pt';
  }
  const p1free = free();
  const p2 = document.querySelector('.p2');
  const p2free = (page.offsetHeight - 44 / pt - (p2.offsetTop + p2.offsetHeight)) * pt;
  return {p1free: p1free, p2free: p2free};
}"""


def main():
    from playwright.sync_api import sync_playwright
    data = json.load(open(os.path.join(HERE, 'agents.json'), encoding='utf-8'))
    want = set(sys.argv[1:])
    exe = os.environ.get('SG_CHROMIUM')
    bad = []
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
        for a in data['agents']:
            if want and a['slug'] not in want:
                continue
            if not want and a.get('approved_original'):
                print('SKIP ' + a['name'] + ': the approved original PDF is kept as is (name the slug to rebuild it)')
                continue
            src = os.path.join(HERE, '_' + a['slug'] + '.html')
            open(src, 'w', encoding='utf-8').write(page_html(a))
            pg = b.new_page()
            pg.goto('file://' + src)
            pg.evaluate('document.fonts.ready')
            free = pg.evaluate(PLACE_JS)
            name = a['name'].replace(' ', '_') + '_Seller_Guide.pdf'
            pg.pdf(path=os.path.join(OUT, name), width='8.5in', height='11in', print_background=True, prefer_css_page_size=True)
            pg.close()
            os.remove(src)
            ok = free['p1free'] >= 6 and free['p2free'] >= 6
            if not ok:
                bad.append(a['name'])
            print(('OK   ' if ok else 'OVERFLOW ') + name + '  free above footer: page 1 %.1fpt, page 2 %.1fpt' % (free['p1free'], free['p2free']))
        b.close()
    if bad:
        sys.exit('Content does not fit for: ' + ', '.join(bad) + '. Shorten the bio or testimonial in agents.json.')


if __name__ == '__main__':
    main()
