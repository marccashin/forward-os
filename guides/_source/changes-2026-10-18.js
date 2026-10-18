// Text changes of October 18, 2026, applied on top of content.js (the October 17 edition).
// Every change names the exact old text and fails the build if that text is not found exactly once,
// so a change can never land in the wrong place or silently do nothing.
'use strict';

function stage(c, section, num, title) {
  const sec = c.sections.find((s) => s.title === section);
  if (!sec) throw new Error('no section ' + section);
  const st = sec.stages.filter((s) => s.num === num && s.title === title);
  if (st.length !== 1) throw new Error(`stage ${section} ${num} ${title}: found ${st.length}`);
  return st[0];
}
function idx(list, text, where) {
  const i = list.map((it, k) => (it.text === text ? k : -1)).filter((k) => k >= 0);
  if (i.length !== 1) throw new Error(`${where}: "${text}" found ${i.length} times`);
  return i[0];
}
function replace(list, oldText, newTexts, where) {
  const i = idx(list, oldText, where);
  list.splice(i, 1, ...newTexts.map((t) => ({ text: t })));
}
function remove(list, oldText, where) { list.splice(idx(list, oldText, where), 1); }
function insertAfter(list, afterText, newText, where) { list.splice(idx(list, afterText, where) + 1, 0, { text: newText }); }

function apply(c) {
  // LISTINGS stage 5, Listing Agreement Signed
  let s = stage(c, 'Listings', 5, 'Listing Agreement Signed');
  replace(s.you, 'Expect Concierge to contact you to schedule and coordinate listing photos.',
    ['Set the listing photo and video day and time, then tell Concierge so they can send your seller the “Your Media Day” email.'], 'L5 you');
  replace(s.you, 'Going Coming Soon? Once all information is loaded and accurate in Bright, slide the Follow Up Boss deal card to Coming Soon and tell Transactions to mark it Coming Soon in the MLS.',
    ['Going Coming Soon? Once all information is loaded and accurate in Bright, mark the listing Coming Soon in Bright and slide the Follow Up Boss deal card to Coming Soon. You give the final approval: Transactions marks it only if you ask them to.'], 'L5 you');
  replace(s.you, 'When the home is ready for showings: update the status in Bright to Active, slide the Follow Up Boss deal card to Listed, and change the Follow Up Boss lead stage to Active Listing.',
    ['When the home is ready for showings: update the status in Bright to Active (Transactions does this only if you ask), slide the Follow Up Boss deal card to Listed, and change the Follow Up Boss lead stage to Active Listing.'], 'L5 you');
  replace(s.concierge, 'Confirms photo and video dates and times with you and the seller, then sends the seller the “Your Media Day” email.',
    ['Sends the seller the “Your Media Day” email once you give Concierge the photo and video day and time.'], 'L5 concierge');

  // LISTINGS stage 7, Coming Soon
  s = stage(c, 'Listings', 7, 'Coming Soon');
  replace(s.you, 'Make sure Transactions knows to mark the listing Coming Soon in the MLS.',
    ['Mark the listing Coming Soon in Bright, or ask Transactions to do it for you.'], 'L7 you');
  remove(s.concierge, 'Shares the Coming Soon marketing with you and the seller.', 'L7 concierge');
  idx(s.concierge, 'Posts the Coming Soon announcement on social media.', 'L7 concierge (kept)');
  replace(s.transactions, 'Marks the listing Coming Soon in the MLS.',
    ['Marks the listing Coming Soon in the MLS only when you ask them to.'], 'L7 transactions');
  idx(s.transactions, 'Sends the Coming Soon Active Pipe.', 'L7 transactions (kept)');

  // BUYERS stage 4, Tag: FWRD Buyer Onboarding
  s = stage(c, 'Buyers', 4, 'Tag: FWRD Buyer Onboarding');
  insertAfter(s.you, 'Request the Buyer Agreement and buyer disclosures: FORWARD OS, Agent Tools, Buyer Representation Agreement Request.',
    'Review and approve the Buyer Agreement and buyer disclosures PDF that Transactions sends you, so Transactions can send it to your buyer for signatures.', 'B4 you');
  replace(s.transactions, 'Prepares the Buyer Agreement and buyer disclosures from your request in FORWARD OS and sends them to your buyer for signatures.', [
    'Prepares the Buyer Agreement and buyer disclosures from your request in FORWARD OS.',
    'Sends you the PDF of the Buyer Agreement and buyer disclosures to review and approve. Nothing goes to your buyer before you approve.',
    'Once you approve, sends them to your buyer for signatures.',
  ], 'B4 transactions');

  // Page 12 footnote: new date, set in the sentence's own font (the October 17 PDF had it in a stray font)
  const fn = c.also.footnote;
  if (fn.date !== 'October 17, 2026') throw new Error('footnote date is ' + fn.date);
  fn.date = 'October 18, 2026';
  fn.dateStrayFont = false;
  return c;
}

module.exports = { apply };
