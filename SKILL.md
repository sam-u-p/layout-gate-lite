---
name: layout-gate-lite
description: Checks a site just generated or edited by an AI agent (Lovable, Bolt, v0, Framer, Claude Code, Cursor) for one visible defect, a page wider than the screen: sideways scroll on mobile and elements sticking out of the screen. For every finding it returns a ready-to-paste fix instruction. Use it after generating or editing pages, before handing over, or when the user asks whether the page scrolls sideways or something sticks out.
---

# Layout gate lite

## When to use it

After every generation or edit of a site, before saying it is finished. It measures the rendered page in the browser, not the code, at 390 and 768 px (1440 on request).

## Prerequisites

Node 22 or higher and Google Chrome. Nothing to install. If the site is local, its server must be running.

Start Chrome headless on a free port (add `--use-angle=metal` on macOS if the page uses WebGL). The Chrome path below is the macOS one; on other systems use your own Chrome path, or set `CHROME_BIN`:

```
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --remote-debugging-port=9341 --user-data-dir=/tmp/gate-lite-profile about:blank &
```

If nothing listens on the port, the script starts its own headless Chrome for the run.

## Command

Run the script, do not read it:

```
node gate-lite.mjs / /contact/ --base https://example.com --cdp-port 9341 --out gate-report.json
```

Routes are the arguments without `--`. For a local site use `--base http://127.0.0.1:PORT`. Add `--viewports 390x844,768x1024,1440x900` to change the viewports.

## How to read the output

The console summary lists every finding, numbered. The JSON file holds the same content in `segnalazioni[]`:

- `classe`: always `difetto`, something you can see or measure on the page.
- `gravita`: `blocco` makes the command exit with code 1; `avviso` is only reported.
- `viewport`: where it was seen.
- `fix`: the instruction to apply, one or two sentences.

The "Made with / Edit with" badge or button of Lovable, Bolt, v0 and Framer is ignored on purpose: it does not belong to the site.

## What it measures

Defects (class `difetto`):
- sideways scroll of the page, sampled over time (blocking);
- elements sticking out of the screen that no ancestor clips. Blocking only when the page really scrolls sideways, otherwise a warning. An element counts as clipped when any ancestor, `body` and `html` included, has `overflow-x` other than `visible` (carousels, hidden overflow).

## Rule

Apply the fixes, run again, repeat until there are 0 blocking findings (exit code 0). Do not declare the site ready with exit code 1.

1. Read `segnalazioni[]` where `gravita` equals `blocco`.
2. Apply every `fix` to the site code, one per finding, without touching anything else.
3. Run the same command again and compare: the fixed findings must disappear, no new one must appear.
4. After the third round with the same findings, stop and report to the user the exact text of the ones left.

## Limits

Canvas, WebGL and scroll-linked effects are not measured. A page that hides its content behind a login cannot be reached. A page that hides overflow with `overflow-x: hidden` passes the check even though the content may be cut off on the screen.

Layout Gate Pro adds five more defect checks (text under 14px, orphan heading lines, narrow column at 1440, tap targets under 24px, text over buttons and links) plus an HTML report: [FULL VERSION LINK].
