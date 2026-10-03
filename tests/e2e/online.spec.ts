import { test, expect } from "@playwright/test";
test("two authenticated contexts create/join, Ready, finish and rematch", async ({
  browser,
}, testInfo) => {
  const options =
    testInfo.project.name === "mobile"
      ? {
          viewport: { width: 390, height: 844 },
          isMobile: true,
          hasTouch: true,
        }
      : { viewport: { width: 1440, height: 1000 } };
  const a = await browser.newContext(options),
    b = await browser.newContext(options),
    one = await a.newPage(),
    two = await b.newPage();
  const errors: string[] = [];
  one.on("pageerror", (e) => errors.push(e.message));
  two.on("pageerror", (e) => errors.push(e.message));
  try {
    await one.goto("/");
    await two.goto("/");
    await one.getByRole("button", { name: "前往對戰大廳" }).click();
    await one.getByRole("button", { name: "建立私人房間" }).click();
    await expect(one.locator(".room-code")).toBeVisible();
    const code = await one.locator(".room-code").textContent();
    await two.getByRole("button", { name: "前往對戰大廳" }).click();
    await two.getByLabel("6 位房間碼").fill(code!);
    await two.getByRole("button", { name: "加入房間", exact: true }).click();
    await expect(one.getByRole("button", { name: "我準備好了" })).toBeEnabled({
      timeout: 10000,
    });
    await one.getByRole("button", { name: "我準備好了" }).click();
    await expect(two.getByText("準備完成", { exact: true })).toBeVisible({
      timeout: 10000,
    });
    await two.getByRole("button", { name: "我準備好了" }).click();
    await expect(one.getByRole("heading", { name: "好友對戰" })).toBeVisible({
      timeout: 15000,
    });
    await expect(two.getByRole("heading", { name: "好友對戰" })).toBeVisible();
    await expect(
      one.getByRole("button", { name: "硬降", exact: true }),
    ).toBeEnabled({ timeout: 15000 });
    await expect(
      two.getByRole("button", { name: "硬降", exact: true }),
    ).toBeEnabled();
    await one.getByRole("button", { name: "硬降", exact: true }).click();
    await expect(one.getByTestId("score")).not.toHaveText("0");
    await one.screenshot({
      path: `test-results/${testInfo.project.name}-online.png`,
      fullPage: true,
    });
    for (let i = 0; i < 25; i++) {
      if (await one.getByRole("dialog").isVisible()) break;
      const drop = one.getByRole("button", { name: "硬降", exact: true });
      if (await drop.isDisabled()) break;
      await drop.click();
    }
    await expect(
      one.getByRole("heading", { name: "下一局，再挑戰" }),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      two.getByRole("heading", { name: "漂亮的一局！" }),
    ).toBeVisible();
    await one.getByRole("button", { name: "再玩一局" }).click();
    await expect(two.getByRole("button", { name: "再玩一局" })).toBeEnabled();
    await two.getByRole("button", { name: "再玩一局" }).click();
    await expect(
      one.getByRole("button", { name: "硬降", exact: true }),
    ).toBeEnabled({ timeout: 15000 });
    await expect(one.getByTestId("score")).toHaveText("0");
    expect(errors).toEqual([]);
  } finally {
    await a.close();
    await b.close();
  }
});
