#!/usr/bin/env node
/*
 * FORWARD OS: the seller campaign's Listing Description headline. Run on every pull request.
 *
 * Until Oct 24, 2026 the big headline on the Listing Description page was the first
 * sentence of the description cut at character 100 when that sentence was longer
 * ("... has stood on one of Old Town Al"), and the rest of that first paragraph was
 * dropped from the page whether or not the headline was cut. Marc: never silently
 * truncate an agent's marketing copy.
 *
 * This slices the real buildCampPkg() out of index.html (no browser needed) and
 * checks, for a spread of descriptions:
 *   1. NOTHING IS LOST: the words of the saved description, in order, are exactly the
 *      words of the headline, the body paragraphs and the closer. The expected text
 *      is built here from the input, not by the code under test.
 *   2. A first sentence over 100 characters is the whole headline, never cut.
 *   3. A short first sentence (100 or fewer, ending in punctuation) gives the same
 *      headline as before.
 *   4. The last word of the headline is the one set in gold italics.
 *
 * Usage: node ci/campaign-headline-test.js <repo dir>
 */
'use strict';
const fs = require('fs');
const path = require('path');
const dir = process.argv[2] || '.';
const src = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const a = src.indexOf('function buildCampPkg(');
const end = src.indexOf('\n}\n', a) + 3;
if (a < 0 || end < 3) { console.error('FAIL: buildCampPkg not found'); process.exit(1); }
const build = new Function(src.slice(a, end) + '\nreturn buildCampPkg;')();

const prop = { address: '123 Prince St, Alexandria, VA 22314' };
const mls = { listPrice: '$2,000,000', beds: '3', baths: '2.5', sqft: '2,400', yearBuilt: '1800' };
const LONG = "Built in 1800 and marked with an early survey plaque, this residence has stood on one of Old Town Alexandria's most storied blocks for more than two centuries.";
const REST = 'Everything was addressed. New electrical throughout.';
const cases = {
  'long first sentence': LONG + '\n\n' + REST + '\n\nClose.',
  'long first sentence plus more in the paragraph': LONG + ' It was restored with care in 2024.\n\n' + REST,
  'short single sentence': 'A quiet home on a quiet street.\n\n' + REST + '\n\nClose.',
  'two short sentences': 'A quiet home. On a quiet street.\n\n' + REST,
  'short sentence then more': 'Light fills every room of this home. The kitchen opens to a terrace and the garden beyond it, with space for twelve at the table.\n\n' + REST,
  'no ending punctuation': 'A very long opening line with no ending punctuation at all that keeps going past one hundred characters easily and never stops\n\n' + REST,
  'only one paragraph': LONG,
  'bold markdown': '**' + LONG + '**\n\n' + REST,
  'decimals and commas': 'This 2.5 bath residence, built in 1800, offers 2,400 square feet across three levels with a garden of 0.25 acres in Old Town.\n\n' + REST,
};
const words = (t) => t.replace(/<[^>]+>/g, '').split(/\s+/).filter(Boolean).join(' ');
let fails = 0, n = 0;
function ok(cond, label) { n++; if (!cond) { fails++; console.log('FAIL: ' + label); } }

for (const [name, text] of Object.entries(cases)) {
  const pkg = build([{ title: 'Listing Description', content: text }], prop, 'Marc Cashin', mls);
  const l = pkg.listing;
  const expected = words(text.replace(/\*/g, '').split(/\n{2,}/).join(' '));
  const got = words([l.statementHtml].concat(l.columns, [l.closer]).join(' '));
  ok(got === expected, name + ': every word of the description is on the page, in order\n  expected: ' + expected + '\n  got:      ' + got);
  const head = words(l.statementHtml);
  const firstPara = text.replace(/\*/g, '').split(/\n{2,}/)[0];
  const firstSentence = (firstPara.match(/^.{20,}?[.!?](?=\s|$)/s) || [firstPara])[0];
  if (firstSentence.length > 100) {
    ok(words(firstPara).startsWith(head), name + ': headline is the start of the paragraph');
    ok(head.length >= words(firstSentence).length, name + ': a first sentence over 100 characters is not cut (headline ' + head.length + ' vs sentence ' + words(firstSentence).length + ')');
  }
  const em = l.statementHtml.match(/<em>([^<]+)<\/em>$/);
  ok(!!em && head.endsWith(em[1]), name + ': the last headline word is the gold italic one');
}
// Same as before where the old code was already right.
{
  const pkg = build([{ title: 'Listing Description', content: 'A quiet home on a quiet street.\n\nOne body paragraph here.\n\nClose.' }], prop, 'Marc Cashin', mls);
  ok(pkg.listing.statementHtml === 'A quiet home on a quiet <em>street.</em>', 'short sentence: headline markup unchanged');
  ok(JSON.stringify(pkg.listing.columns) === '["One body paragraph here."]' && pkg.listing.closer === 'Close.', 'short sentence: body and closer unchanged');
}
console.log(fails ? ('campaign headline test: ' + fails + ' of ' + n + ' FAILED') : ('campaign headline test: all ' + n + ' passed'));
process.exit(fails ? 1 : 0);
