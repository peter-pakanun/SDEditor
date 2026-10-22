# Dimmer Use English cue

Local styling follow-up to released `ea528786bc42b2dacba8d7479eb3a814db69ce13`, on `style/dim-eng-placeholder`. Independent review is pending; no push or deployment is performed.

The only product change is the Use English cue rule in `public/client-text.css`. It keeps the existing muted theme color and applies 85% opacity in light/grey and 65% in dark/modern-dark. The same opacity applies to the native placeholder, whitespace-only highlight overlay and collapsed-row cue. Other text, formatting controls, status colors and the English preview are unchanged. The exact string remains `-- Use English --`; no JavaScript behavior, target value, counter, eligibility, persistence, history, export, schema or API changes.

Measured released cues were substantially stronger than the ordinary native placeholder, particularly in dark themes. One opacity for all themes either left dark cues prominent or made the light selected row harder to read. These two narrowly scoped opacity levels bring input/overlay contrast closer to the existing native placeholder while keeping the checked cue/background contrast above 3:1. This is a rendering measurement and visual review, not a claim of full accessibility conformance.

| Theme | Cue opacity | Calculated contrast across checked surfaces |
|---|---:|---:|
| Light | 0.85 | 3.19–4.17 |
| Grey | 0.85 | 3.77–4.43 |
| Dark | 0.65 | 3.13–3.80 |
| Modern dark | 0.65 | 3.12–3.77 |

Validation:

- **32 rendered cases**: four desktop themes × compact/spacious density × full native field, inline native field, inline whitespace overlay and selected collapsed row. Every cue is dimmer than the released baseline. Native/overlay contrast is closer to the ordinary placeholder in every comparison; minimum calculated contrast is **3.12:1**. Screenshots were inspected in all four themes. CSS colors/alpha were composited over the actual computed solid background layers; all measured backgrounds had no image layer. The presentation projections leave saved work unchanged.
- The existing normal-mode synthetic SPA acceptance still passes **13 transition/presentation cases, four invalid-state projections and four theme checks**, with real Vue, worker/IndexedDB, localhost API saves and workbook download. Blank/identical activation, revocation, source/conflict behavior, English preview, visible Missing/progress and blank-target export remain correct; no placeholder leaks into stored data or the workbook. Zero page errors and inference requests.
- Entire frontend suite: **3,797 passed; zero failures/skips/cancellations**. Changed JavaScript syntax and `git diff --check` pass. No new unit test merely duplicates the CSS declaration; the new check measures the rendered result.

Reproduce with `NODE_PATH` set to the installed project dependencies:

```text
ENG_PLACEHOLDER_STYLE_PHASE=baseline node scripts/clienttext-browser-fixture.cjs --english-presentation-only --english-placeholder-style --keep
ENG_PLACEHOLDER_STYLE_PHASE=candidate ENG_PLACEHOLDER_STYLE_BASELINE=<baseline-report> node scripts/clienttext-browser-fixture.cjs --english-presentation-only --english-placeholder-style --keep
node --test --test-concurrency=2 --test-timeout=120000 --test-reporter=spec scripts/test-*.cjs
```

Capture baseline while the released CSS is checked out. Recorded baseline: `temp/sdeditor-clienttext-browser-wyjVOj/eng-placeholder-style-results.json`; candidate: `temp/sdeditor-clienttext-browser-aBVmHR/eng-placeholder-style-results.json`. Each directory contains 16 screenshots (full, inline, whitespace and collapsed for all four themes). Logs: `temp/eng-placeholder-dim-baseline.log`, `temp/eng-placeholder-dim-browser.log`, `temp/eng-placeholder-dim-full-frontend.log`.

Coverage is desktop Edge at 1440×1000 with generated synthetic workbook data. Mobile and hosted acceptance are outside this local follow-up. No private samples, live model, production account/workbook, API deployment or earlier denied read is used. No execution blocker or uncertain outcome remains.
