# Spatial navigation verification

The interface keeps all five existing artwork files unchanged. Only the full-bleed artwork moves through perspective; chapter controls remain in a stable reading region beside it. Long content scrolls within that region. Wheel and touch gestures there do not spill into chapter navigation.

Run the real-browser regression suite from `red-demo`:

```sh
npm ci
npm install --no-save playwright
npx playwright install --with-deps chromium
npm run build -- --mode training
node test/spatial.browser.mjs
```

The test serves the actual production build and recorded training fixtures over a local HTTP server. It does not mock the navigation, forms, generator, evidence, QR training results, or export code. Playwright is a test-only runtime and is not added to application dependencies.

Coverage: all five chapters at 1440×900, 390×844, 1024×600 and 320×640; navigation/footer clearance; page overflow; transparent content surfaces; inactive chapters and focus; forward/back depth frames; wheel and keyboard navigation; touch navigation; scrolling boundaries; form and selection persistence; history; motion preferences; training evidence; QR sample results; JSON export; browser exceptions.

Screenshots and measured bounds are written to `output/playwright/`. The suite waits for the arrival fade to complete before measuring and capturing a chapter. Chromium desktop and emulated mobile are covered; this does not certify Safari or physical mobile hardware. The live Flask API is outside this frontend regression suite.

The existing two lint warnings in `src/CaseReport.jsx` are outside the changed files.
