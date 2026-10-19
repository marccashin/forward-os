#!/usr/bin/env python3
# Compare two PDFs of the guide: page count, stage start pages, text (pdftotext -layout),
# line wrapping, geometry of matched lines, and pixel differences.
# Usage: compare.py A.pdf B.pdf [--geom] [--pixels OUTDIR] [--quiet]
import sys, subprocess, difflib, collections, json, os, re
sys.path.insert(0, '/tmp/tools/ittt/py')
import pdfplumber

A, B = sys.argv[1], sys.argv[2]
GEOM = '--geom' in sys.argv
PIX = sys.argv[sys.argv.index('--pixels') + 1] if '--pixels' in sys.argv else None


def lines_of(p):
    ws = p.extract_words(extra_attrs=['fontname', 'size', 'non_stroking_color'], keep_blank_chars=True,
                         use_text_flow=True, x_tolerance=1.5)
    out = []
    for w in ws:
        out.append(dict(x0=w['x0'], x1=w['x1'], top=w['top'], font=w['fontname'].split('+')[-1],
                        size=round(w['size'], 1), text=w['text']))
    # merge fragments on one visual line (letter-spaced words, font switches)
    out.sort(key=lambda l: (l['top'], l['x0']))
    m = []
    for l in out:
        for o in m:
            if abs(o['top'] - l['top']) < 0.7 and 0 <= l['x0'] - o['x1'] < 6:
                o['text'] += (' ' if l['x0'] - o['x1'] > 1.0 else '') + l['text']
                o['x1'] = l['x1']
                break
        else:
            m.append(dict(l))
    for l in m:
        l['text'] = re.sub(r'\s+', ' ', l['text']).strip()
    return m


def stage_pages(pdf):
    res = []
    for i, p in enumerate(pdf.pages, 1):
        for l in lines_of(p):
            if l['font'].startswith('Cormorant') and 13.5 < l['size'] < 14.5:
                res.append((l['text'], i))
            if l['font'].startswith('Cormorant') and 19.5 < l['size'] < 20.5:
                res.append(('[H] ' + l['text'], i))
    return res


pa, pb = pdfplumber.open(A), pdfplumber.open(B)
print('pages: A=%d B=%d' % (len(pa.pages), len(pb.pages)))
sa, sb = stage_pages(pa), stage_pages(pb)
bad = [(x, y) for x, y in zip(sa, sb) if x != y]
print('stage/heading start pages: %d in A, %d in B, %d differ' % (len(sa), len(sb), len(bad) + abs(len(sa) - len(sb))))
for x, y in bad:
    print('   A', x, ' B', y)


def layout(pdf, n):
    return subprocess.run(['pdftotext', '-layout', '-f', str(n), '-l', str(n), pdf, '-'], capture_output=True, text=True).stdout


print('\n== text (pdftotext -layout), words in order ==')
tot_word_diffs = 0
for n in range(1, max(len(pa.pages), len(pb.pages)) + 1):
    ta, tb = layout(A, n), layout(B, n)
    wa, wb = ta.split(), tb.split()
    sm = difflib.SequenceMatcher(a=wa, b=wb, autojunk=False)
    ops = [o for o in sm.get_opcodes() if o[0] != 'equal']
    tot_word_diffs += len(ops)
    print('page %2d: %d words A, %d words B, %s' % (n, len(wa), len(wb), 'IDENTICAL' if not ops else '%d differences' % len(ops)))
    for tag, i1, i2, j1, j2 in ops:
        print('     %s A:%r  B:%r' % (tag, ' '.join(wa[i1:i2]), ' '.join(wb[j1:j2])))
print('total word-sequence differences:', tot_word_diffs)

print('\n== line wrapping (each visual line, by page) ==')
tot_lines = tot_diff = 0
geo = collections.defaultdict(list)
for n in range(1, min(len(pa.pages), len(pb.pages)) + 1):
    la = [l for l in lines_of(pa.pages[n - 1]) if l['top'] < 760]
    lb = [l for l in lines_of(pb.pages[n - 1]) if l['top'] < 760]
    ca = collections.Counter(l['text'] for l in la)
    cb = collections.Counter(l['text'] for l in lb)
    miss = ca - cb
    extra = cb - ca
    nd = sum(miss.values())
    tot_lines += len(la)
    tot_diff += nd
    print('page %2d: %d lines in A, %d in B, %d lines of A not found identically in B' % (n, len(la), len(lb), nd))
    for t in miss:
        print('     A only: %r' % t)
    for t in extra:
        print('     B only: %r' % t)
    # geometry of matched lines
    bt = collections.defaultdict(list)
    for l in lb:
        bt[l['text']].append(l)
    for l in la:
        if bt.get(l['text']):
            m = min(bt[l['text']], key=lambda x: abs(x['top'] - l['top']) + abs(x['x0'] - l['x0']))
            bt[l['text']].remove(m)
            key = '%s %.1f' % (l['font'], l['size'])
            geo[key].append((n, m['x0'] - l['x0'], m['top'] - l['top'], (m['x1'] - m['x0']) - (l['x1'] - l['x0']), l['text'][:40], l['top']))
print('lines: %d in A, %d not reproduced identically (%.1f%%)' % (tot_lines, tot_diff, 100.0 * tot_diff / max(1, tot_lines)))

if GEOM:
    print('\n== geometry of matched lines (B - A, pt) ==')
    for k, v in sorted(geo.items()):
        dx = [x[1] for x in v]; dy = [x[2] for x in v]; dw = [x[3] for x in v]
        print('%-34s n=%4d dx[%.2f..%.2f] dy[%.2f..%.2f] dwidth[%.2f..%.2f]' % (k, len(v), min(dx), max(dx), min(dy), max(dy), min(dw), max(dw)))
    worst = sorted([x for v in geo.values() for x in v], key=lambda x: -abs(x[2]))[:15]
    for w in worst:
        print('   p%d dx=%.2f dy=%.2f dw=%.2f top=%.1f %r' % (w[0], w[1], w[2], w[3], w[5], w[4]))

if PIX:
    from PIL import Image, ImageChops
    import numpy as np
    os.makedirs(PIX, exist_ok=True)
    for pdf, tag in ((A, 'a'), (B, 'b')):
        subprocess.run(['pdftoppm', '-r', '100', '-png', pdf, os.path.join(PIX, tag)], check=True)
    print('\n== pixels at 100 dpi ==')
    allp = []
    for n in range(1, min(len(pa.pages), len(pb.pages)) + 1):
        fa = os.path.join(PIX, 'a-%02d.png' % n); fb = os.path.join(PIX, 'b-%02d.png' % n)
        ia = Image.open(fa).convert('RGB'); ib = Image.open(fb).convert('RGB')
        a = np.asarray(ia).astype(int); b = np.asarray(ib).astype(int)
        d = np.abs(a - b).max(axis=2)
        p_any = 100.0 * (d > 0).mean(); p_32 = 100.0 * (d > 32).mean()
        allp.append((n, p_any, p_32))
        # difference image: grey copy of A, differing pixels red (B only ink) / blue
        base = np.asarray(ia.convert('L').convert('RGB')).astype(np.uint8) // 3 + 170
        out = base.copy()
        mask = d > 32
        out[mask] = [220, 0, 0]
        Image.fromarray(out).save(os.path.join(PIX, 'diff-%02d.png' % n))
        sbs = Image.new('RGB', (ia.width * 2 + 10, ia.height), 'white')
        sbs.paste(ia, (0, 0)); sbs.paste(ib, (ia.width + 10, 0))
        sbs.save(os.path.join(PIX, 'side-%02d.png' % n))
        print('page %2d: %.2f%% pixels differ at all, %.2f%% differ by more than 32/255' % (n, p_any, p_32))
    json.dump(allp, open(os.path.join(PIX, 'pixels.json'), 'w'))
