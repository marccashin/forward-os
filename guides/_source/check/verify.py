#!/usr/bin/env python3
# Checks on a built guide PDF: page count, stage boxes whole on one page, nothing outside its box,
# column or the page margins, no em dash, and the font of the footnote date.
import sys, collections
sys.path.insert(0, '/tmp/tools/ittt/py')
import pdfplumber

pdf = pdfplumber.open(sys.argv[1])
PW, PH, M = 612, 792, 0.55 * 72
NAVY = (0.0392, 0.1373, 0.2588)
r4 = lambda c: tuple(round(x, 4) for x in c) if isinstance(c, (list, tuple)) else c
problems = []
print('pages:', len(pdf.pages))
emdash = endash = 0
stage_count = 0
for n, p in enumerate(pdf.pages, 1):
    chars = [c for c in p.chars if c['top'] < 765]  # page content (footer drawn separately below)
    foot = [c for c in p.chars if c['top'] >= 765]
    for c in p.chars:
        emdash += c['text'] == '\u2014'; endash += c['text'] == '\u2013'
    # page margins
    for c in chars:
        if c['x0'] < M - 0.5 or c['x1'] > PW - M + 0.5 or c['top'] < M - 0.5 or c['bottom'] > PH - M + 0.5:
            problems.append('p%d char %r outside page margins at (%.1f,%.1f)' % (n, c['text'], c['x0'], c['top']))
    for c in foot:
        if c['x0'] < 0 or c['x1'] > PW or c['bottom'] > PH:
            problems.append('p%d footer char outside page' % n)
    # stage boxes: rounded outline curves wider than 500pt that contain a navy header bar
    boxes = [b for b in p.curves if not b['fill'] and b['x1'] - b['x0'] > 500]
    hdrs = [r for r in p.rects if r4(r['non_stroking_color']) == NAVY and 30 < r['height'] < 45 and r['width'] > 500]
    for h in hdrs:
        bx = [b for b in boxes if b['top'] <= h['top'] + 1 and b['bottom'] >= h['bottom']]
        if len(bx) != 1:
            problems.append('p%d stage header at %.1f has %d boxes' % (n, h['top'], len(bx)))
            continue
        b = bx[0]; stage_count += 1
        if b['bottom'] > PH - M + 0.5:
            problems.append('p%d stage box bottom %.1f below the page margin' % (n, b['bottom']))
        inside = [c for c in chars if b['top'] - 1 <= c['top'] <= b['bottom'] + 1]
        for c in inside:
            if c['x0'] < b['x0'] or c['x1'] > b['x1'] or c['bottom'] > b['bottom']:
                problems.append('p%d char %r outside its stage box' % (n, c['text']))
        # columns: separators are 0.75pt rects inside the box below the header
        seps = sorted([r for r in p.rects if r['width'] < 1 and r['height'] > 20 and b['top'] < r['top'] < b['bottom']], key=lambda r: r['x0'])
        if len(seps) == 2:
            colbot = max(r['bottom'] for r in seps)
            coltop = min(r['top'] for r in seps)
            edges = [b['x0'], seps[0]['x0'], seps[1]['x0'], b['x1']]
            for c in inside:
                if c['top'] < coltop: continue
                for i in range(3):
                    if edges[i] - 0.1 <= c['x0'] < edges[i + 1]:
                        if c['x1'] > edges[i + 1] - 6:  # 8px padding: text must stop before the separator
                            problems.append('p%d char %r runs into column edge (x1=%.1f edge=%.1f)' % (n, c['text'], c['x1'], edges[i + 1]))
                if c['bottom'] > colbot + 0.5:
                    problems.append('p%d char %r below the column background' % (n, c['text']))
            print('p%-2d stage box %.1f-%.1f (height %.1f pt), lowest text %.1f, page content limit %.1f' % (
                n, b['top'], b['bottom'], b['bottom'] - b['top'], max(c['bottom'] for c in inside), PH - M))
        else:
            problems.append('p%d stage at %.1f: %d column separators' % (n, h['top'], len(seps)))
    # any text overlapping other text (two glyphs drawn on top of each other)
    seen = collections.defaultdict(list)
    for c in chars:
        seen[(round(c['top']), round(c['x0'] / 2))].append(c)
    for k, v in seen.items():
        if len(v) > 1 and len(set(round(x['x0'], 1) for x in v)) < len(v) and any(x['text'].strip() for x in v):
            problems.append('p%d overlapping glyphs near %s: %r' % (n, k, ''.join(x['text'] for x in v)))
print('stage boxes found:', stage_count)
print('em dashes (U+2014):', emdash, ' en dashes (U+2013):', endash)
last = pdf.pages[-1]
date = [c for c in last.chars if 655 < c['top'] < 670 and c['text'] in '0123456789']
fonts = collections.Counter(c['fontname'].split('+')[-1] for c in last.chars if 655 < c['top'] < 668)
print('page %d footnote line fonts:' % len(pdf.pages), dict(fonts))
print('problems: %d' % len(problems))
for x in problems[:40]:
    print('  ', x)
