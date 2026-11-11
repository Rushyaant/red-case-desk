# Spatial navigation verification

The interface keeps all five existing artwork files unchanged. Only the full-bleed artwork moves through perspective; chapter controls remain in a stable reading region beside it. Long content scrolls within that region. Wheel and touch gestures there do not spill into chapter navigation.

Run the real-browser regression suite from `red-demo`:

```sh
npm ci
npm install --no-save playwright @axe-core/playwright
npx playwright install --with-deps chromium
npm run build -- --mode training
node test/spatial.browser.mjs
```

Set `TEST_ORIGIN=https://red-case-desk.vercel.app` to run against production, or
`PLAYWRIGHT_BROWSER=webkit` to repeat the cross-browser checks in WebKit. The
low-level synthetic touch gesture is Chromium-only; the remaining checks run in
both engines.

The test serves the actual production build and recorded training fixtures over a local HTTP server. It does not mock the navigation, forms, generator, evidence, QR training results, or export code. Playwright is a test-only runtime and is not added to application dependencies.

Coverage: all five chapters at 1440×900, 390×844, 1024×600 and 320×640; navigation/footer clearance; page overflow; transparent content surfaces; inactive chapters and focus; forward/back depth frames; wheel and keyboard navigation; touch navigation; scrolling boundaries; form and selection persistence; history; motion preferences; training evidence; QR sample results; JSON export; browser exceptions.

Screenshots and measured bounds are written to `output/playwright/`. The suite waits for the arrival fade to complete before measuring and capturing a chapter. Chromium desktop and emulated mobile are covered; this does not certify Safari or physical mobile hardware. The live Flask API is outside this frontend regression suite.

The existing two lint warnings in `src/CaseReport.jsx` are outside the changed files.


## Skill-guided follow-up

| Guidance applied | Concrete change or check |
| --- | --- |
| better-accessibility | Native disabled endpoints, keyboard skip link, chapter titles, accessible names that include visible button text. |
| better-layout and UI/UX Pro Max | 44px navigation targets; a horizontal chapter rail on narrow screens; overflow handling for enlarged text. |
| better-typography | Phone fields render at least 16px, preventing automatic input zoom. |
| better-colors | Input-border contrast increased from 2.16:1 to 4.46:1 against the existing input fill. |
| better-writing | Back/Forward names match visible labels; current chapter appears in the browser title. |
| better-ui | Real disabled states; contained scrolling remains separate from scene travel. |
| web3d-integration-patterns and react-spring-physics | Only visible artwork receives transform updates; compositing hints are released at rest; idle and interrupted travel are tested. |
| Taste and Impeccable | Preserve the art-led split composition, common content edges, readable hierarchy, and existing artwork. |
| Web App QA accessibility and visual review | Playwright, axe scans of all chapters, enlarged-text checks, focus/touch checks and the existing six-issue regressions. |

Skills about VR sessions, asset creation, slide authoring and unrelated animation engines were reviewed for relevance but were not executed. This pass does not add XR, replace artwork or combine competing animation engines. Taste's company-page generation gate was not run for this existing task interface; no gate pass or full WCAG certification is claimed.


Final follow-up run: 15 Playwright/Chromium tests passed, 0 failed, 0 skipped. The production training build passed. Axe scanned all five chapters with no automated violations; image/gradient contrast was marked incomplete and is not certified by that scan. The input border's solid-color contrast was measured separately. At 200% text size on mobile, the entire reading region becomes scrollable when the heading needs more space; original-size chapter travel is unchanged. Lint remains at zero errors and the same two existing warnings. Physical devices and screen-reader speech were not tested.
