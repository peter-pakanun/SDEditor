import { expect, test } from "@playwright/test";

test("loads dummy workspace in test mode", async ({ page }) => {
  await page.goto("/?testMode=1&lang=Thai");

  await expect(page).toHaveTitle(/SDEditor/);
  await expect(page.getByPlaceholder("Search...")).toBeVisible();
  await expect(page.locator("#table tbody tr")).toHaveCount(2);
});
