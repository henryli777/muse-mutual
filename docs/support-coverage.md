# Public Support Navigation

All public MUSE views link to https://support.coinexo.top/ with the visible
label "支持项目". The shared public header stays sticky on desktop and mobile;
the footer repeats the link. Public 404/error fallbacks use the same chrome.
The native feedback dialog has its own sticky navigation because opening a
modal makes the background header inert. Admin pages and API fallbacks do not
include donation navigation.

The canonical public deployment is https://muse.coinexo.top/. Preserve the
legacy Sites origin's redirect to this domain; publishing the application
over the redirect would undo the self-hosted migration.

## Browser Regression

Start the local development server, then run the maintained Playwright CLI:

```sh
npm run dev -- --port 8788 --host 127.0.0.1
~/.codex/skills/playwright/scripts/playwright_cli.sh -s=muse-support open http://127.0.0.1:8788/
~/.codex/skills/playwright/scripts/playwright_cli.sh -s=muse-support run-code --filename tests/public-support.browser.js
~/.codex/skills/playwright/scripts/playwright_cli.sh -s=muse-support close
```

The check covers six desktop/mobile sizes, including a 300px-tall desktop and
a 320px-wide phone; home/anchor/404 routes; page and modal scrolling; loading
and API-error states; and admin/API exclusions. It checks viewport geometry,
hit-testing and the exact destination, not only whether a link exists in the
DOM. Invitation/session/error fixtures are intercepted only inside the test
browser. It never submits feedback, claims a code or writes production data.

Run `npm test`, `npm run typecheck`, and `npm run build:selfhost` before release.
Use a new server release and retain `/opt/muse-mutual/state` and the existing
secrets file. Do not upload a local database or browser fixture.
