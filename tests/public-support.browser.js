async (page) => {
  const origin = new URL(page.url()).origin;
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const checkLink = async (selector) => page.locator(selector).evaluate((link) => {
    const rect = link.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return link.textContent.includes("支持项目") && link.href === "https://support.coinexo.top/"
      && rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight
      && (hit === link || link.contains(hit));
  });
  const invite = {
    id: "support-browser-fixture", code: "LOCAL-UI-FIXTURE", nickname: "Browser fixture",
    remaining: 3, available: 3, copiedCount: 0, createdAt: "2026-10-13T00:00:00Z",
    updatedAt: "2026-10-13T00:00:00Z", reviewStatus: "normal", reportCount: 0, reportReasons: [],
  };
  // Fixtures affect this browser only; never submit or insert production invites.
  await page.route("**/api/session", (route) => route.fulfill({ json: {} }));
  await page.route("**/api/invites?*", (route) => route.fulfill({
    json: { invites: [invite], availableTotal: 1, nextOffset: null },
  }));
  const results = [];
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1366, height: 300 },
    { width: 768, height: 1024 }, { width: 521, height: 800 }, { width: 390, height: 844 },
    { width: 320, height: 640 }]) {
    await page.setViewportSize(viewport);
    for (const route of ["/", "/#invites", "/#guide", "/support-coverage-missing"]) {
      await page.goto(origin + route);
      await page.locator(".site-header .support-link").waitFor();
      for (const scroll of [0, 500, 100000]) {
        await page.evaluate((y) => window.scrollTo(0, y), scroll);
        await page.waitForTimeout(80);
        assert(await checkLink(".site-header .support-link"), `Public support inaccessible: ${route}, ${JSON.stringify(viewport)}, ${scroll}`);
        results.push({ route, viewport, scroll });
      }
    }
    await page.goto(origin + "/#invites");
    await page.getByRole("button", { name: "反馈问题" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    assert(await dialog.getByRole("link", { name: "支持项目" }).count() === 1, "Public feedback dialog must expose its own support link; background header is inert");
    for (const scroll of [0, 100000]) {
      await dialog.evaluate((element, y) => element.scrollTo(0, y), scroll);
      assert(await checkLink("dialog .support-link"), `Dialog support inaccessible: ${JSON.stringify(viewport)}, ${scroll}`);
      results.push({ route: "report-dialog", viewport, scroll });
    }
    await page.getByRole("button", { name: "关闭反馈" }).click();
  }
  for (const route of ["/admin", "/admin/support-coverage-missing", "/api/support-coverage-missing"]) {
    await page.goto(origin + route);
    assert(await page.getByRole("link", { name: "支持项目", exact: true }).count() === 0, `Private/API support exclusion violated: ${route}`);
  }
  await page.unroute("**/api/invites?*");
  let releaseLoading;
  const loading = new Promise((resolve) => { releaseLoading = resolve; });
  await page.route("**/api/invites?*", async (route) => {
    await loading;
    await route.fulfill({ status: 503, json: { error: { code: "ui_fixture", message: "Browser-only service error" } } });
  });
  await page.goto(origin + "/#invites");
  await page.getByRole("heading", { name: "正在加载共享邀请码…" }).waitFor();
  assert(await checkLink(".site-header .support-link"), "Loading state must retain public support");
  releaseLoading();
  await page.getByRole("alert").filter({ hasText: "Browser-only service error" }).waitFor();
  assert(await checkLink(".site-header .support-link"), "API error state must retain public support");
  await page.unrouteAll({ behavior: "wait" });
  return { checks: results.length + 5, passed: true, fixture: "browser-only; no data writes" };
}
