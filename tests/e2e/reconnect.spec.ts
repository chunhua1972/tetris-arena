import { test, expect, type Page } from "@playwright/test";
import { choosePlan } from "../../src/ai/search";
import type { GameState, InputAction } from "../../src/domain/types";
async function checkpoint(page: Page): Promise<GameState> {
  const stored = await page.evaluate(() => {
    const key = Object.keys(sessionStorage).find((k) =>
      k.startsWith("arena:match:"),
    );
    return key ? JSON.parse(sessionStorage.getItem(key)!).game : null;
  });
  if (!stored) throw new Error("waiting for checkpoint");
  return { ...stored, board: new Uint8Array([...stored.board].map(Number)) };
}
const label = (action: InputAction) =>
  action.type === "MOVE"
    ? action.dx === -1
      ? "左移"
      : "右移"
    : action.type === "ROTATE"
      ? action.direction === -1
        ? "左旋"
        : "右旋"
      : action.type === "HOLD"
        ? "保留"
        : "硬降";
test("duplicate attacks, lost ACKs and a short network outage recover correctly", async ({
  browser,
  request,
}, info) => {
  test.skip(
    info.project.name === "mobile",
    "Network failure uses desktop; mobile has a complete two-player match test.",
  );
  test.setTimeout(120000);
  const a = await browser.newContext(),
    b = await browser.newContext(),
    one = await a.newPage(),
    two = await b.newPage();
  try {
    await request.post("http://127.0.0.1:54329/__test/seed", {
      data: { seed: "protocol-fixture-0" },
    });
    await one.goto("/");
    await two.goto("/");
    await one.getByRole("button", { name: "前往對戰大廳" }).click();
    await one.getByRole("button", { name: "建立私人房間" }).click();
    await expect(one.locator(".room-code")).toBeVisible();
    const code = await one.locator(".room-code").textContent();
    await two.getByRole("button", { name: "前往對戰大廳" }).click();
    await two.getByLabel("6 位房間碼").fill(code!);
    await two.getByRole("button", { name: "加入房間", exact: true }).click();
    await expect(one.getByRole("button", { name: "我準備好了" })).toBeEnabled();
    await one.getByRole("button", { name: "我準備好了" }).click();
    await expect(two.getByText("準備完成", { exact: true })).toBeVisible();
    await two.getByRole("button", { name: "我準備好了" }).click();
    await expect(
      one.getByRole("button", { name: "硬降", exact: true }),
    ).toBeEnabled({ timeout: 15000 });
    await expect(
      two.getByRole("button", { name: "硬降", exact: true }),
    ).toBeEnabled();
    await request.post("http://127.0.0.1:54329/__test/chaos", {
      data: { duplicateAttacks: true, dropNextAck: true },
    });
    await expect.poll(async () => (await checkpoint(one)).lockIndex).toBe(0);
    for (let i = 0; i < 35; i++) {
      const state = await checkpoint(one);
      if (state.attacksSent > 0) break;
      const plan = choosePlan(state, "normal");
      expect(plan).not.toBeNull();
      for (const action of plan!.actions)
        await one
          .getByRole("button", { name: label(action), exact: true })
          .click();
      await expect
        .poll(async () => (await checkpoint(one)).lockIndex)
        .toBe(state.lockIndex + 1);
    }
    const sent = (await checkpoint(one)).attacksSent;
    expect(sent).toBeGreaterThan(0);
    await expect
      .poll(async () => (await checkpoint(two)).attacksReceived)
      .toBe(sent);
    await expect
      .poll(async () =>
        one.evaluate(() => {
          const key = Object.keys(sessionStorage).find((k) =>
            k.startsWith("arena:match:"),
          )!;
          return JSON.parse(sessionStorage.getItem(key)!).sync.unacked.length;
        }),
      )
      .toBe(0);
    expect((await checkpoint(two)).attacksReceived).toBe(sent);
    await b.setOffline(true);
    await expect(
      two.getByRole("button", { name: "硬降", exact: true }),
    ).toBeDisabled({ timeout: 10000 });
    await b.setOffline(false);
    await expect(
      two.getByRole("button", { name: "硬降", exact: true }),
    ).toBeEnabled({ timeout: 15000 });
    await two.getByRole("button", { name: "硬降", exact: true }).click();
    await expect(two.getByTestId("score")).not.toHaveText("0");
  } finally {
    await request.post("http://127.0.0.1:54329/__test/chaos", { data: {} });
    await a.close();
    await b.close();
  }
});
