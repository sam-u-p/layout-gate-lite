# layout-gate-lite

Checks whether a page is wider than the screen. It opens the page in headless Chrome, samples the horizontal scroll width over time and lists every element that sticks out of the screen without being clipped, with a ready-to-paste fix for each one.

## Prerequisites

Node 22 or higher and Google Chrome. Nothing to install. The default Chrome path is the macOS one (`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`); on other systems set `CHROME_BIN`. If nothing listens on the CDP port, the script starts a headless Chrome for the run. If the site is local, its server must be running.

## Command

```
node gate-lite.mjs / /contact/ --base http://127.0.0.1:8000 --cdp-port 9223 --out gate-report.json
```

Routes are the arguments without `--`. Default viewports are 390x844 and 768x1024; add 1440 with `--viewports 390x844,768x1024,1440x900`. Other options: `--config <file>` (a `gate-lite.config.json` with `base`, `cdpPort`, `viewports`, `routes`). Environment: `BASE`, `CDP_PORT`, `CHROME_BIN`.

Exit code: 0 no blocking finding, 1 at least one blocking finding, 2 setup problem.

## Example output

A page with a 600px wide box, run at 390x844:

```
gate-lite  base http://127.0.0.1:8999  CDP 9488 (Chrome/155.0.8059.40)  config none
FAIL  /wide-element.html @ 390x844
      scrollW 600 > 390
      sticks out: DIV L0 R600

=== gate-lite summary ===
http://127.0.0.1:8999  routes 1  viewports 390x844
Findings 2 (blocking 2, warnings 0)

#1 [difetto/blocco] scroll-orizzontale  /wide-element.html @ 390x844
   scrollW 600 > 390
   fix: The page scrolls sideways (content 600px wide on a 390px screen). Find the widest element and cap it with max-width: 100%, or set overflow-x: clip on its container.

#2 [difetto/blocco] fuori-bordo  /wide-element.html @ 390x844
   sticks out: DIV L0 R600
   fix: Bring DIV back inside the screen: it sticks out (left 0, right 600). Use max-width: 100%, or remove the margin or transform that pushes it out.

JSON: gate-report.json
RESULT: there are blocking findings. Apply the fixes and run again.
```

The JSON file has the same content in `segnalazioni[]` (fields `id`, `classe`, `gravita`, `tipo`, `route`, `viewport`, `dettaglio`, `fix`) plus the counts of blocking findings and warnings.

An element counts as clipped when any ancestor, `body` and `html` included, has `overflow-x` other than `visible`. An element sticking out is blocking only when the page really scrolls sideways; otherwise it is a warning.

## Use as a Claude Code skill

Copy this folder to `~/.claude/skills/layout-gate-lite/`. `SKILL.md` tells the agent when to run it, how to read the output and when to stop.

## Tests

```
node test/run.mjs
```

Serves five fixtures on 127.0.0.1, starts Chrome and checks the expected result for each. Prints `N/N passed`.

## Limits

Canvas, WebGL and scroll-linked effects are not measured. Pages behind a login cannot be reached. A page that hides overflow with `overflow-x: hidden` passes, even if content ends up cut off.

Layout Gate Pro adds five more defect checks (text under 14px, orphan heading lines, narrow column at 1440, tap targets under 24px, text over buttons and links) plus an HTML report: [FULL VERSION LINK].

## License

MIT, see `LICENSE`.
