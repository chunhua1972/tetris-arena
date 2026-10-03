import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.route("**/fonts.googleapis.com/**", (route) => route.abort());
  await page.goto("/");
});
test("lobby renders without horizontal overflow", async ({
  page,
}, testInfo) => {
  await expect(
    page.getByRole("heading", { name: "今天，想怎麼玩？" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-lobby.png`,
    fullPage: true,
  });
});
test("solo controls, pause, result, restart and saved record", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("button", { name: "快速開始" }).click();
  await expect(page.getByRole("heading", { name: "單人挑戰" })).toBeVisible();
  await page.getByRole("button", { name: "硬降", exact: true }).click();
  await expect(page.getByTestId("score")).not.toHaveText("0");
  await page.getByRole("button", { name: "暫停遊戲" }).click();
  await expect(page.getByText("喘口氣，再出發")).toBeVisible();
  const before = await page.getByTestId("score").textContent();
  await page.keyboard.press("Space");
  expect(await page.getByTestId("score").textContent()).toBe(before);
  await page
    .locator(".board-overlay")
    .getByRole("button", { name: "繼續遊戲", exact: true })
    .click();
  const controls = await page.getByLabel("觸控遊戲控制").boundingBox();
  expect(controls!.y + controls!.height).toBeLessThanOrEqual(
    testInfo.project.name === "mobile" ? 844 : 1000,
  );
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-solo.png`,
    fullPage: true,
  });
  for (let i = 0; i < 25; i++) {
    const dialog = page.getByRole("dialog");
    if (await dialog.isVisible()) break;
    try {
      await page
        .getByRole("button", { name: "硬降", exact: true })
        .click({ timeout: 2000 });
    } catch (error) {
      if (await dialog.isVisible()) break;
      throw error;
    }
  }
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("成績已保存在這台裝置。")).toBeVisible();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("arena:scores") ?? "[]").length,
    ),
  ).toBe(1);
  await page.getByRole("button", { name: "再玩一局" }).click();
  await expect(page.getByTestId("score")).toHaveText("0");
  expect(errors).toEqual([]);
});
test("AI plays in the worker and touch controls do not overflow", async ({
  page,
}, testInfo) => {
  await page.getByRole("button", { name: "挑戰 AI" }).click();
  await expect(
    page.getByRole("heading", { name: "AI 對戰 · 普通" }),
  ).toBeVisible();
  await expect(page.locator(".opponent-stats strong").first()).not.toHaveText(
    "0",
    { timeout: 15000 },
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-ai.png`,
    fullPage: true,
  });
});
test("local leaderboard is empty and nickname survives reload", async ({
  page,
}) => {
  await page.getByRole("button", { name: "編輯玩家暱稱" }).click();
  await page.getByRole("textbox", { name: "玩家暱稱" }).fill("測試玩家");
  await page.getByRole("textbox", { name: "玩家暱稱" }).press("Enter");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "編輯玩家暱稱" }),
  ).toContainText("測試玩家");
  await page.getByRole("button", { name: "休閒排行榜", exact: true }).click();
  await expect(page.getByText("第一個紀錄，從你開始")).toBeVisible();
});
test("pointercancel releases a held touch button", async ({ page }) => {
  await page.getByRole("button", { name: "快速開始" }).click();
  const left = page.getByRole("button", { name: "左移", exact: true });
  await left.dispatchEvent("pointerdown", {
    pointerId: 44,
    pointerType: "touch",
    bubbles: true,
  });
  await left.dispatchEvent("pointercancel", {
    pointerId: 44,
    pointerType: "touch",
    bubbles: true,
  });
  await page.getByRole("button", { name: "硬降", exact: true }).click();
  await expect(page.getByTestId("score")).not.toHaveText("0");
});
