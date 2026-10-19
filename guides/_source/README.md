# FORWARD: If This, Then That (generator)

This folder rebuilds the 12-page agent guide "FORWARD: If This, Then That" as a PDF. Chromium prints it from HTML, the same way the original was made.

## Files

| File | What it is |
|---|---|
| `content.js` | All the guide's text as data: the cover, the team cards, the "Stages at a glance" flows, every Listings and Buyers stage (number, title, trigger line, Happens automatically, YOU, CONCIERGE, TRANSACTIONS), the "Also automatic" table and the footnote. The text was copied programmatically from `orig/guide.pdf` (see "Where the text came from" below). Each stage also has `page`, the page it starts on. |
| `changes-2026-10-18.js` | The October 18, 2026 text changes, applied on top of `content.js`. Each change names the exact old text, and the build stops if that text is not found exactly once. |
| `template.js` | The HTML/CSS template. Sizes, colours, spacing and column widths were measured from the original PDF. |
| `build.js` | Renders the template with Playwright (`page.pdf`, Letter, `printBackground: true`, with the footer "FORWARD · If This, Then That · October 2026" and "N / 12"). |
| `check/compare.py` | Compares two PDFs: page count, the page each stage starts on, words in order per page, line wrapping, and pixel differences at 100 dpi. |
| `check/verify.py` | Checks one PDF. Every stage box must sit whole on one page, no text may run outside its box, column or the page margins, there must be no em dash, and it reports the fonts on the footnote line. |
| `package.json` | Pinned font package versions (see "Fonts"). |

## Build

```bash
# one time: fonts (installed outside this folder)
mkdir -p /tmp/tools/ittt && cd /tmp/tools/ittt && npm init -y >/dev/null
npm install @fontsource/cormorant-garamond@5.2.5 @fontsource/montserrat@5.1.0 @fontsource-variable/montserrat@5.3.0
pip install --break-system-packages --target /tmp/tools/ittt/py pdfplumber   # only for the checks

# build (run from this folder)
export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers NODE_PATH=/opt/npm-tools/node_modules
node build.js --edition corrected --out ../build/FORWARD_If_This_Then_That.pdf   # current guide (Oct 18 changes)
node build.js --edition original  --out ../build/rebuilt.pdf                      # Oct 17 text, to compare with orig/guide.pdf

# check
python3 check/verify.py ../build/FORWARD_If_This_Then_That.pdf
python3 check/compare.py ../orig/guide.pdf ../build/rebuilt.pdf --pixels ../build/compare
```

`FONT_DIR` changes where the fonts are read from. The default is `/tmp/tools/ittt/node_modules`. Every build also writes the HTML next to the PDF.

## Changing the guide

1. Edit the text in `content.js`, or add a new dated changes file in the same style as `changes-2026-10-18.js` and use it in `build.js`. Write curly quotes (“ ”, ’) where the guide uses them. Never use an em dash.
2. A stage that should start a new page keeps its `page` number. The template puts a page break before any stage whose `page` differs from the stage before it, and no stage is ever split across pages.
3. Build, then run `check/verify.py`. Page 4 (Listings stage 5) is the fullest page. After the Oct 18 changes, its box ends at 749.6pt and the page content limit is 752.4pt. About one more line of text in that stage's YOU column will push the stage onto a new page.

## Fonts

- Headings: Cormorant Garamond SemiBold from `@fontsource/cormorant-garamond@5.2.5`. That version still calls itself `CormorantGaramond-SemiBold`, like the original. 5.3.0 is a different build.
- Body: Montserrat Regular, SemiBold and Bold from `@fontsource/montserrat@5.1.0`. These files call themselves `MontserratThin-*`, which is the name the original PDF shows. Version 5.2 and later changed some glyph widths, for example the bold "C", and that changes the line breaks. The italic "Nothing for ..." lines are Chromium's slanted Regular, as in the original. No italic font is loaded.
- Footer: Chromium's default sans-serif, which is the system Inter on this machine. The original footer is Inter too.
- `Montserrat Stray`: `@fontsource-variable/montserrat`. It is used only for text that `content.js` marks `strayFont: true` (see below).

## Where the text came from

The original source files were lost. The text was extracted from `orig/guide.pdf` with pdfplumber. Lines were grouped into bullets using the PDF's own bullet dots and columns using x positions, then joined with single spaces (no line in the PDF ends in a hyphen). The extraction scripts are in `../work/` (`extract.py`, `structure.py`, `gen_content.py`). Do not retype text from memory.

## Known quirks of the October 17 PDF

Four places in the original were edited into the PDF after Chromium printed it. They use a non-subset "Montserrat Regular" font, sit in their own drawing layer and have their own line breaks:

- page 6, Listings stage 10 Pending, Concierge: "Checks in with Transactions after all contingencies clear, and gets the clear to close when it comes in." and "After closing, checks that the post-closing program started in the Command Center." (the editor also drew the bullet dot for the second one)
- page 11, Buyers stage 7 Pending, Concierge: "Has the team closing gift ready at the Mass Ave office and tells you when to pick it up."
- page 12 footnote: the date "October 17, 2026"

`content.js` marks these with `strayFont: true`, or `dateStrayFont` for the date. The template draws them in a second Montserrat file, so the rebuild shows them in a different font just as the original does. The Oct 18 edition sets the date in the sentence's own font. The three page 6 and 11 bullets still use the stray font. To fix those too, delete their `strayFont` flags.
