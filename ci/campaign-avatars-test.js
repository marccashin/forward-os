#!/usr/bin/env node
/*
 * FORWARD OS: buyer avatars in the seller campaign. Run on every pull request.
 *
 * Until Oct 24, 2026 avatars redone in the Listing Description Writer's chat
 * ("**1. Margaret & Theodore Hale, 59 and 62**", an italic role line, a short story,
 * "**Why this residence now:**", "**Hook:**") came out of the campaign as ONE card
 * holding the second avatar's text, cut at 400 characters.
 *
 * This slices the real buildCampPkg() out of index.html. The avatar text is BUILT HERE
 * from known pieces, so the expected cards do not come from the code under test:
 *   1. Chat format, with and without the chat's intro line and rule: one card per avatar,
 *      name without its number, ages split from the name, role as occupation, story as
 *      summary, Why now, Hook as the pull quote.
 *   2. The page's own labeled format (Profile N, N. Name, bold names): every field.
 *   3. NOTHING IS LOST: every piece of every avatar is on a card, and text that fits
 *      no field is kept whole (no 400 character cut).
 *
 * Usage: node ci/campaign-avatars-test.js <repo dir>
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
const cards = (text) => build([{ title: 'Buyer Avatars', content: text }], prop, 'Marc Cashin', mls);
let fails = 0, n = 0;
function ok(cond, label) { n++; if (!cond) { fails++; console.log('FAIL: ' + label); } }

const P = [1, 2, 3, 4, 5].map((i) => ({
  name: ['Margaret & Theodore Hale', 'Dr. Priya Raghunathan', 'Alexander & Noor Behzadi', 'Daniel Okafor', 'Claire & James Whitmore'][i - 1],
  age: ['59 and 62', '45', '48 and 46', '52', '41 and 43'][i - 1],
  role: 'Role line number ' + i + ' with a second sentence. It runs on.',
  story: 'Story number ' + i + ' goes here. It is two sentences, and it is long enough to matter ' + 'word '.repeat(60).trim() + '.',
  why: 'Why number ' + i + '. A complete renovation means zero contractor management. ' + 'reason '.repeat(50).trim() + '.',
  hook: 'Hook number ' + i + ' is one sentence.',
}));
const chat = (p, i) => '**' + (i + 1) + '. ' + p.name + ', ' + p.age + '**\n*' + p.role + '*\n' + p.story + ' **Why this residence now:** ' + p.why + ' **Hook:** ' + p.hook;
const chatText = P.map(chat).join('\n\n');
const withIntro = 'Here are the five revised avatars.\n\n---\n\n' + chatText;

for (const [label, text] of [['chat format', chatText], ['chat format with intro line and rule', withIntro]]) {
  const pkg = cards(text), b = pkg.buyerProfiles;
  ok(b.length === 5, label + ': five cards, got ' + b.length);
  P.forEach((p, i) => {
    const c = b[i] || {};
    ok(c.name === p.name, label + ' #' + (i + 1) + ': name without number or ages (' + c.name + ')');
    ok(c.age === p.age, label + ' #' + (i + 1) + ': ages (' + c.age + ')');
    ok(c.occupation === p.role, label + ' #' + (i + 1) + ': role line is the occupation');
    ok(c.summary === p.story, label + ' #' + (i + 1) + ': story is the summary, whole');
    ok(c.whyNow === p.why, label + ' #' + (i + 1) + ': Why this residence now, whole');
    ok(c.stopScrolling === p.hook, label + ' #' + (i + 1) + ': Hook is the pull quote');
  });
  ok(!pkg.buyerIntro, label + ': a one-line chat intro is not printed');
}
// A long preamble is kept, not dropped.
const longPre = 'These avatars were redone after the description changed.\nThey keep the same five buyers.\n\n' + chatText;
ok(/redone after the description changed/.test(cards(longPre).buyerIntro) && /same five buyers/.test(cards(longPre).buyerIntro), 'a multi-line preamble is kept as the intro');

// The page's own labeled format.
const lab = (p, i) => 'Name: ' + p.name + '\nAge: ' + (40 + i) + '\nOccupation: Job ' + i + '\nNet Worth Range: $' + (i + 1) + 'M to $' + (i + 3) + 'M\nLeaving Behind: old ' + i + '\nMoving Toward: new ' + i + '\nAfraid Of: fear ' + i + '\nStop-Scrolling Sentence: Sentence ' + i + '.';
const styles = {
  'Profile N headers': P.map((p, i) => 'Profile ' + (i + 1) + '\n' + lab(p, i)).join('\n\n'),
  'numbered plain headers': P.map((p, i) => (i + 1) + '. ' + p.name + '\n' + lab(p, i).split('\n').slice(1).join('\n')).join('\n\n'),
  'numbered bold headers': P.map((p, i) => '**' + (i + 1) + '. ' + p.name + '**\n' + lab(p, i).split('\n').slice(1).join('\n')).join('\n\n'),
  'bold name headers': P.map((p, i) => '**' + p.name + '**\n' + lab(p, i).split('\n').slice(1).join('\n')).join('\n\n'),
};
for (const [label, text] of Object.entries(styles)) {
  const b = cards(text).buyerProfiles;
  ok(b.length === 5, label + ': five cards, got ' + b.length);
  P.forEach((p, i) => {
    const c = b[i] || {};
    ok(c.name === p.name, label + ' #' + (i + 1) + ': name (' + c.name + ')');
    ok(c.age === String(40 + i) && c.occupation === 'Job ' + i, label + ' #' + (i + 1) + ': age and occupation');
    ok(c.netWorth === '$' + (i + 1) + 'M to $' + (i + 3) + 'M', label + ' #' + (i + 1) + ': net worth');
    ok(c.leavingBehind === 'old ' + i && c.movingToward === 'new ' + i && c.afraidOf === 'fear ' + i, label + ' #' + (i + 1) + ': the three blocks');
    ok(c.stopScrolling === 'Sentence ' + i + '.', label + ' #' + (i + 1) + ': stop-scrolling sentence');
  });
}
// Labeled format with Why now and Hook as labeled lines (what the avatar tool will write).
const both = P.map((p, i) => (i + 1) + '. ' + p.name + ', ' + p.age + '\n' + lab(p, i).split('\n').slice(1).join('\n').replace(/Stop-Scrolling Sentence: .*/, '') + 'Why this residence now: ' + p.why + '\nHook: ' + p.hook).join('\n\n');
const bb = cards(both).buyerProfiles;
ok(bb.length === 5 && bb.every((c, i) => c.whyNow === P[i].why && c.stopScrolling === P[i].hook && c.afraidOf === 'fear ' + i && c.age === String(40 + i)), 'labeled blocks with Why now and Hook: every field');

// Nothing is cut when the text cannot be split.
const blob = 'Buyers for this house\n\n' + 'A long unsplittable avatar text with no headers at all. '.repeat(30);
const one = cards(blob).buyerProfiles;
const words = (t) => String(t || '').replace(/\*/g, '').split(/\s+/).filter(Boolean).join(' ');
ok(one.length === 1 && words(one[0].summary) === words(blob.split('\n\n').slice(1).join(' ')), 'unsplittable text: kept whole on one card (' + (one[0] ? (one[0].summary || '').length : 0) + ' of ' + blob.split('\n\n')[1].length + ' characters)');

// Every word of every piece is on a card, chat format.
const printed = cards(chatText).buyerProfiles.map((c) => [c.name, c.age, c.occupation, c.summary, c.whyNow, c.stopScrolling].join(' ')).join(' ');
const expectedWords = P.map((p) => [p.name, p.age, p.role, p.story, p.why, p.hook].join(' ')).join(' ');
ok(words(printed.replace(/,/g, '')) === words(expectedWords.replace(/,/g, '')), 'chat format: every word of every avatar is on a card, in order');

console.log('campaign avatars test: ' + (fails ? fails + ' of ' + n + ' FAILED' : 'all ' + n + ' passed'));
process.exit(fails ? 1 : 0);
