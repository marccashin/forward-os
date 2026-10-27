#!/usr/bin/env python3
"""Meet Your Advisor, BUYER side: two pages per agent, sent before a buyer consultation.

Marc, Oct 27, 2026. Reuses the seller guide's CSS, fonts, page 1 layout and fit check from build.py, so
the two documents always look alike. Agent data (photo, bio, contact, testimonial)
comes from the same agents.json.

Output: ../../buyer-guides/<First>_<Last>_Buyer_Guide.pdf (linked by BUYER_GUIDES in index.html).

The buyer agreement box is compensation language Marc approved on Oct 27, 2026. Do not
reword it without his approval: it must keep saying compensation is not set by law and
is fully negotiable, is agreed in writing before touring, and can never exceed the agreement.
The title line is a recommendation; the buyer chooses the title company.
"""
import json, os, sys
import build as S
from build import e

HERE = S.HERE
OUT = os.path.abspath(os.path.join(HERE, '..', '..', 'buyer-guides'))

CSS_ADD = """
.pt{margin-top:5pt;column-gap:14.5pt;}
.pt h3{font-size:10.67pt;line-height:14pt;}
.pt p{font-size:8.9pt;line-height:12.2pt;}
.agree{background:#000033;color:#fff;padding:7pt 12pt 9pt;margin-top:13pt;}
.agree .lab{color:#b9b9d5;}
.agree p{font-size:9pt;line-height:13pt;margin-top:2pt;}
.steps5{margin-top:4pt;column-gap:14.5pt;row-gap:8pt;}
.p2 .rule2{margin-top:13pt;}
.p2 h2{margin-top:12pt;}
.p2 .pt{row-gap:6pt;}

"""

EXPECT = [
    ("You set the pace", "You decide when to tour, when to offer, and when to walk away. We never push you toward an offer before you are ready."),
    ("Honest advice", "We tell you what a home is worth, what it will cost to own, and what we would fix or avoid, even when it is not what you hoped to hear."),
    ("One team handles the details", "Our team coordinates inspections, appraisals, paperwork, and deadlines, so you are not juggling it all."),
    ("Access before the market", "Through our network we often hear about homes before they are listed, so you can see them first."),
]
STEPS = [
    ("Discovery and strategy", "We learn your lifestyle, the locations you want, the homes you love, and your timeline, and put our agreement in writing."),
    ("Curated selection", "We match homes to your criteria, on the market and before it, so your time goes to the right ones."),
    ("Due diligence", "Comparable sales, property condition, and where the neighborhood is heading, so you know what a home is worth before you offer."),
    ("Negotiation", "Strategic offers, including when several buyers want the same home, with terms that protect you."),
    ("Closing and beyond", "We manage every detail through settlement and remain your resource for years after."),
]
AGREEMENT = ("Before we tour homes together, we sign a written buyer agreement. It sets out what we do for you, "
             "how long we work together, and how we are paid. Our compensation is not set by law and is fully negotiable, "
             "and we agree on it in writing before we tour any homes. A seller may cover all or part of it: we ask for that "
             "in your written offer, where it is negotiated like any other term. We will negotiate for the seller to cover all of it, "
             "and if any part would be yours to pay, you will know the amount and agree to it in writing first. "
             "You will never owe us more than your agreement states.")
READY = [
    ("Talk to our financial team first", "A pre-approval sets your range and shows sellers you are ready to buy."),
    ("Know your must-haves", "Separate what you need from what you would like. It speeds every decision."),
    ("Have your funds ready to show", "Keep your down payment and deposit where you can document them quickly."),
    ("Share your timing", "Tell us about a lease end date or a home to sell, so we can plan closing around it."),
]
PARTNER_FIN = "Before you search, our financial team shows you what you can comfortably afford, strengthens your financing, and shows how a home fits your wealth plan."
PARTNER_TITLE = "You choose your title company. We recommend SMART Settlements, our preferred partner, proven to exceed our standards in execution and service."


def page_html(a):
    bio = ''.join('<p>' + e(p) + '</p>' for p in a['bio'])
    quotes = ''
    for q in a['quotes']:
        note = ('<span class="bn">, ' + e(q['by_note']) + '</span>') if q.get('by_note') else ''
        quotes += '<div class="qb">"' + e(q['text']) + '"<div class="by">' + e(q['by']) + note + '</div></div>'
    qcls = 'g2 q' + (' one' if len(a['quotes']) == 1 else '')
    expect = ''.join('<div><h3>' + e(t) + '</h3><p>' + e(b) + '</p></div>' for t, b in EXPECT)
    order = [0, 3, 1, 4, 2]  # left column 1-3, right column 4-5, laid out row by row
    steps = ''.join('<div class="step"><div class="c">' + str(i + 1) + '</div><h4>' + e(STEPS[i][0]) + '</h4><p>' + e(STEPS[i][1]) + '</p></div>' if i is not None else '<div></div>' for i in order + [None])
    ready = ''.join('<div><h3>' + e(t) + '</h3><p>' + e(b) + '</p></div>' for t, b in READY)
    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>' + e(a['name']) + ' | Buying Your Home</title><style>' + S.CSS + CSS_ADD + '</style></head><body>'
        '<div class="page">'
        '<div class="hdr"><img src="assets/logo-white.png" alt=""><div class="t">Buying Your Home</div>'
        '<div class="s">A clear, personal guide to what happens, when, and who will be with you</div></div>'
        '<div class="intro">Whether you are buying your first home, moving up, or investing, our goal is the same: a confident search, honest advice, and the right home at the right price, with no surprises along the way.</div>'
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
        '<div class="page"><div class="p2">'
        '<div class="lab">How we work</div>'
        '<h1>We Find the Right Home, Then Help You Win It</h1>'
        '<p class="lead">Buying in DC, Maryland, and Northern Virginia rewards preparation. We learn what you want, show you what fits, tell you what each home is truly worth, and negotiate so you make the strongest offer you are comfortable with.</p>'
        '<h2>The Process, Step by Step</h2><div class="g2 steps steps5">' + steps + '</div>'
        '<div class="agree"><div class="lab">Our agreement with you</div><p>' + e(AGREEMENT) + '</p></div>'
        '<hr class="rule2">'
        '<h2>Getting Ready</h2><div class="g2 pt">' + ready + '</div>'
        '<hr class="rule2">'
        '<h2>Our Trusted Partners</h2>'
        '<div class="g2 pt"><div><h3>Financial Strategy</h3><p>' + e(PARTNER_FIN) + '</p></div>'
        '<div><h3>Title and Settlement: SMART Settlements</h3><p>' + e(PARTNER_TITLE) + '</p></div></div>'
        '<hr class="rule2">'
        '<p class="team"><b>A full team behind you:</b> transaction management, client concierge, market intelligence, and financial strategy. &nbsp;<b>$300M+</b> team sales &nbsp;|&nbsp; <b>300+</b> transactions</p>'
        '<p class="cta">The first step is simply a conversation. Contact ' + e(a['first']) + ' to plan your search.</p>'
        '</div>'
        '<div class="ftr"><img src="assets/logo-white.png" alt=""><div class="x">' + e(a['name']) + '  |  ' + e(a['phone']) + '  |  ' + e(a['email']) + '</div></div>'
        '</div></body></html>'
    )


def main():
    from playwright.sync_api import sync_playwright
    data = json.load(open(os.path.join(HERE, 'agents.json'), encoding='utf-8'))
    want = set(sys.argv[1:])
    exe = os.environ.get('SG_CHROMIUM')
    bad = []
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
        for a in data['agents']:
            if want and a['slug'] not in want:
                continue
            src = os.path.join(HERE, '_b_' + a['slug'] + '.html')
            open(src, 'w', encoding='utf-8').write(page_html(a))
            pg = b.new_page(); pg.goto('file://' + src); pg.evaluate('document.fonts.ready')
            free = pg.evaluate(S.PLACE_JS)
            name = a['name'].replace(' ', '_') + '_Buyer_Guide.pdf'
            pg.pdf(path=os.path.join(OUT, name), width='8.5in', height='11in', print_background=True, prefer_css_page_size=True)
            pg.close(); os.remove(src)
            ok = free['p1free'] >= 6 and free['p2free'] >= 6
            if not ok: bad.append(a['name'])
            print(('OK   ' if ok else 'OVERFLOW ') + name + '  free above footer: page 1 %.1fpt, page 2 %.1fpt' % (free['p1free'], free['p2free']))
        b.close()
    if bad:
        sys.exit('Content does not fit for: ' + ', '.join(bad))


if __name__ == '__main__':
    main()
