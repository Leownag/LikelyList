/**
 * End-to-end UI walk with Playwright.
 *
 *   npx tsx --env-file=.env.local scripts/ui-test.ts [baseUrl]
 *
 * Drives a real browser against a running dev server: every page, every redirect
 * that decides where somebody lands, and the three flows that write (follow a city,
 * change the schedule, pin a show). Spotify is deliberately untouched — it needs a
 * third-party consent screen this cannot drive.
 *
 * Signs in the way a reader does, through /auth/callback with a `token_hash` minted
 * by the admin API, so the session under test is a real Supabase session rather than
 * a forged cookie. The throwaway account is deleted at the end, whichever way the run
 * finished.
 */
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const SHOTS = process.env.UI_TEST_SHOTS ?? join(tmpdir(), "likelylist-ui-test");
const EMAIL = `ui-test-${Date.now()}@likelylist.test`;

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

type Outcome = "pass" | "fail" | "skip";
const results: { name: string; outcome: Outcome; detail: string }[] = [];
const noise: string[] = [];

async function check(name: string, fn: () => Promise<string | void>) {
  try {
    const detail = (await fn()) ?? "";
    // A check can decide at runtime that its precondition is absent (no seeded
    // events, say) — reported as skipped rather than passed, so an empty database
    // cannot make the run look green.
    const skipped = detail.startsWith("skip:");
    results.push({
      name,
      outcome: skipped ? "skip" : "pass",
      detail: skipped ? detail.slice(5).trim() : detail,
    });
    console.log(`${skipped ? "○" : "✓"} ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    results.push({ name, outcome: "fail", detail });
    console.log(`✗ ${name}\n    ${detail.split("\n")[0]}`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Where the browser ended up, without the origin. */
function path(page: Page): string {
  return page.url().slice(BASE.length) || "/";
}

async function go(page: Page, to: string, waitUntil: "load" | "networkidle" = "load") {
  const response = await page.goto(`${BASE}${to}`, { waitUntil, timeout: 45_000 });
  return response;
}

/**
 * Clicks a server-action submit and waits for the action itself to answer.
 *
 * A server action is a POST to the current URL, not a navigation, so waiting on load
 * state returns immediately and the next `goto` can outrun the write.
 */
async function submit(page: Page, button: Locator) {
  await Promise.all([
    page.waitForResponse(
      (response) => response.request().method() === "POST" && response.url().startsWith(BASE),
      { timeout: 45_000 },
    ),
    button.click(),
  ]);
}

let shotIndex = 0;
async function shot(page: Page, name: string) {
  shotIndex += 1;
  await page.screenshot({
    path: `${SHOTS}/${String(shotIndex).padStart(2, "0")}-${name}.png`,
    fullPage: true,
  });
}

/** Records console errors and uncaught exceptions against the page they happened on. */
function watch(context: BrowserContext) {
  context.on("page", (page) => {
    page.on("console", (message) => {
      if (message.type() === "error") noise.push(`${path(page)} · console: ${message.text()}`);
    });
    page.on("pageerror", (error) => noise.push(`${path(page)} · uncaught: ${error.message}`));
    page.on("response", (response) => {
      if (response.status() >= 500) noise.push(`${path(page)} · ${response.status()} ${response.url()}`);
    });
  });
}

/** A real sign-in link for the throwaway account. */
async function magicLinkPath(): Promise<string> {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: EMAIL,
  });
  if (error || !data.properties?.hashed_token) {
    throw new Error(`Could not mint a sign-in link: ${error?.message}`);
  }
  return `/auth/callback?token_hash=${data.properties.hashed_token}&type=magiclink`;
}

async function signIn(page: Page, next?: string) {
  const link = await magicLinkPath();
  await go(page, next ? `${link}&next=${encodeURIComponent(next)}` : link);
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: EMAIL,
    email_confirm: true,
  });
  if (createError || !created.user) {
    throw new Error(`Could not create the test account: ${createError?.message}`);
  }
  let userId = created.user.id;
  console.log(`test account ${EMAIL}\nbase ${BASE}\n`);

  const browser: Browser = await chromium.launch();

  try {
    // ---- anonymous ------------------------------------------------------------
    const anon = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    watch(anon);
    const page = await anon.newPage();

    await check("landing page renders", async () => {
      const response = await go(page, "/");
      assert(response?.status() === 200, `status ${response?.status()}`);
      await page.locator("h1").first().waitFor();
      const heading = (await page.locator("h1").first().innerText()).trim();
      assert(heading.length > 0, "no h1 text");
      await shot(page, "landing");
      return heading.replace(/\s+/g, " ").slice(0, 40);
    });

    await check("landing → Explore link", async () => {
      await page.getByRole("link", { name: "Explore", exact: true }).first().click();
      await page.waitForURL(`${BASE}/explore`);
      return path(page);
    });

    await check("explore renders its search controls", async () => {
      await page.locator("#explore-mode").waitFor();
      await page.getByRole("button", { name: /Show me this week/i }).waitFor();
      assert(
        (await page.getByRole("button", { name: /^Pin$|^Pinned$/ }).count()) === 0,
        "pin buttons should not render for an anonymous reader",
      );
      await shot(page, "explore");
    });

    await check("explore search returns a week", async () => {
      await page.getByRole("button", { name: /Show me this week/i }).click();
      // Any of the three legitimate outcomes: results, an empty week, or a named error.
      const outcome = page.locator("ul li, [data-empty], p:has-text('did'), p:has-text('nothing')");
      await page.waitForFunction(
        () => !document.body.innerText.includes("Searching…"),
        undefined,
        { timeout: 90_000 },
      );
      await shot(page, "explore-results");
      const cards = await page.locator("ul > li").count();
      void outcome;
      return cards > 0 ? `${cards} shows listed` : "no shows for the default place";
    });

    await check("explore hides pin buttons while signed out", async () => {
      assert(
        (await page.getByRole("button", { name: /^Pin$/ }).count()) === 0,
        "an anonymous reader was offered a pin button",
      );
    });

    await check("privacy page renders", async () => {
      const response = await go(page, "/privacy");
      assert(response?.status() === 200, `status ${response?.status()}`);
      await page.locator("h1").first().waitFor();
    });

    await check("login form renders", async () => {
      await go(page, "/login");
      await page.locator("#email").waitFor();
      await page.getByRole("button", { name: /Send|Email|link|Sign/i }).first().waitFor();
      await shot(page, "login");
    });

    await check("login rejects an empty address without navigating", async () => {
      await page.locator("form button[type=submit]").click();
      await page.waitForTimeout(500);
      assert(path(page).startsWith("/login"), `left /login for ${path(page)}`);
      assert(
        !(await page.getByText(/check your|inbox|sent/i).count()),
        "claimed to have sent a link for an empty address",
      );
    });

    for (const guarded of ["/app", "/app/feed", "/app/pinned", "/app/subscriptions", "/app/settings"]) {
      await check(`${guarded} redirects a stranger to /login`, async () => {
        await go(page, guarded);
        assert(path(page).startsWith("/login"), `landed on ${path(page)}`);
      });
    }

    await check("/app/feeds redirects a stranger to /login", async () => {
      await go(page, "/app/feeds");
      assert(path(page).startsWith("/login"), `landed on ${path(page)}`);
    });

    await check("an invalid sign-in link comes back with a reason", async () => {
      await go(page, "/auth/callback?token_hash=not-a-real-token&type=magiclink");
      assert(path(page).startsWith("/login?error="), `landed on ${path(page)}`);
      await page.locator("#email").waitFor();
      const shown = await page.locator("form").locator("..").innerText();
      assert(/expire|invalid|again|link/i.test(shown), "no reason shown next to the form");
      await shot(page, "login-error");
    });

    await check("a bare callback comes back with a reason", async () => {
      await go(page, "/auth/callback");
      assert(path(page).includes("error="), `landed on ${path(page)}`);
    });

    await check("a ConfirmationURL-style link names the misconfiguration", async () => {
      await go(page, "/auth/callback?code=abc");
      assert(
        decodeURIComponent(path(page)).includes("TokenHash"),
        `expected the template hint, got ${path(page)}`,
      );
    });

    await check("/lang refuses an off-site next", async () => {
      await go(page, "/lang?to=zh-Hant&next=https://evil.example.com/x");
      assert(page.url().startsWith(BASE), `left the origin for ${page.url()}`);
      return path(page);
    });

    await check("/lang refuses a backslash-smuggled next", async () => {
      await go(page, "/lang?to=en&next=/%5Cevil.example.com");
      assert(page.url().startsWith(BASE), `left the origin for ${page.url()}`);
      return path(page);
    });

    await check("?lang=zh-Hant serves Chinese copy", async () => {
      await go(page, "/?lang=zh-Hant");
      const text = await page.locator("body").innerText();
      assert(/[一-鿿]/.test(text), "no Chinese characters on the page");
      await shot(page, "landing-zh");
    });

    await check("the language switch sticks across a navigation", async () => {
      await go(page, "/");
      await page.getByRole("group", { name: "Language" }).getByRole("link").first().click();
      await page.waitForLoadState("load");
      const afterSwitch = await page.locator("body").innerText();
      assert(/[一-鿿]/.test(afterSwitch), "switching did not change the copy");
      // /login rather than /privacy: the privacy policy is deliberately English-only.
      await go(page, "/login");
      const carried = await page.locator("body").innerText();
      assert(/[一-鿿]/.test(carried), "the choice did not survive a navigation");
      const cookie = (await anon.cookies()).find((c) => c.name.includes("lang") || c.name.includes("locale"));
      assert(cookie?.value === "zh-Hant", `locale cookie is ${cookie?.value ?? "absent"}`);
      // Back to English for the rest of the anonymous checks.
      await go(page, "/lang?to=en&next=/");
    });

    await check("an unknown path is a 404", async () => {
      const response = await go(page, "/definitely-not-a-page");
      assert(response?.status() === 404, `status ${response?.status()}`);
    });

    await check("robots.txt and sitemap.xml are served", async () => {
      const robots = await go(page, "/robots.txt");
      assert(robots?.status() === 200, `robots ${robots?.status()}`);
      const sitemap = await go(page, "/sitemap.xml");
      assert(sitemap?.status() === 200, `sitemap ${sitemap?.status()}`);
    });

    await check("/dev-mode reports itself off without the key", async () => {
      await go(page, "/dev-mode");
      const text = await page.locator("body").innerText();
      assert(/dev mode is off/i.test(text), `unexpected body: ${text.slice(0, 80)}`);
    });

    await check("/unsubscribe without a token explains itself", async () => {
      const response = await go(page, "/unsubscribe");
      const text = await page.locator("body").innerText();
      assert(text.trim().length > 0, "blank page");
      return `status ${response?.status()}`;
    });

    await anon.close();

    // ---- signed in ------------------------------------------------------------
    const authed = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    watch(authed);
    const app = await authed.newPage();

    await check("a valid sign-in link lands on /app", async () => {
      await signIn(app);
      await app.waitForURL(`${BASE}/app`, { timeout: 30_000 });
      await app.getByText(EMAIL).first().waitFor();
      await shot(app, "app-overview");
    });

    await check("/login forwards a signed-in reader", async () => {
      await go(app, "/login");
      assert(path(app) === "/app", `landed on ${path(app)}`);
    });

    await check("/login?next= forwards to where the digest pointed", async () => {
      await go(app, "/login?next=%2Fapp%2Fpinned");
      assert(path(app) === "/app/pinned", `landed on ${path(app)}`);
    });

    await check("/login?next= refuses an off-site target", async () => {
      await go(app, "/login?next=https%3A%2F%2Fevil.example.com");
      assert(app.url().startsWith(BASE), `left the origin for ${app.url()}`);
      assert(path(app) === "/app", `landed on ${path(app)}`);
    });

    await check("/app/feeds forwards to the screenshot section", async () => {
      await go(app, "/app/feeds");
      assert(
        path(app).startsWith("/app/subscriptions"),
        `landed on ${path(app)}`,
      );
      return path(app);
    });

    const NAV: [string, string, RegExp][] = [
      ["Overview", "/app", /Overview|總覽|next/i],
      ["My feed", "/app/feed", /My feed|我的清單|nothing this week/i],
      ["Pinned", "/app/pinned", /Pinned|已收藏/],
      ["What I follow", "/app/subscriptions", /Cities|Genres/],
      ["Settings", "/app/settings", /Delivery|Account|時區|Time zone|timezone/i],
    ];

    for (const [label, expected, marker] of NAV) {
      await check(`nav → ${label}`, async () => {
        await go(app, "/app");
        await app.getByRole("navigation").getByRole("link", { name: label, exact: true }).click();
        await app.waitForURL(`${BASE}${expected}`, { timeout: 30_000 });
        const text = await app.locator("main").innerText();
        assert(marker.test(text), `page body did not mention ${marker}`);
        await shot(app, `nav-${expected.replace(/\W+/g, "-")}`);
        return path(app);
      });
    }

    await check("the subscriptions jump links move down the page", async () => {
      await go(app, "/app/subscriptions");
      await app.getByRole("navigation", { name: "Jump to a section" })
        .getByRole("link", { name: "Screenshots" })
        .click();
      await app.waitForFunction(() => window.scrollY > 200, undefined, { timeout: 10_000 });
      assert(app.url().endsWith("#screenshots"), `url is ${path(app)}`);
    });

    await check("following a city and a genre reaches the overview", async () => {
      await go(app, "/app/subscriptions");
      const cityChip = app.locator("#cities button").filter({ hasNotText: /^$/ }).first();
      const genreChip = app.locator("#genres button").first();
      await cityChip.waitFor();
      // First text node only: a city chip carries its state code in a nested span,
      // and the overview renders the two as separate elements.
      const label = (chip: typeof cityChip) =>
        chip.evaluate((el) => (el.childNodes[0]?.textContent ?? "").trim());
      const cityName = await label(cityChip);
      const genreName = await label(genreChip);
      await cityChip.click();
      await genreChip.click();
      const save = app.getByRole("button", { name: /Save changes/i });
      assert(await save.isEnabled(), "Save stayed disabled after two toggles");
      await save.click();
      await app.getByText("Saved.").waitFor({ timeout: 30_000 });
      await shot(app, "subscriptions-saved");

      await go(app, "/app");
      const overview = await app.locator("main").innerText();
      assert(overview.includes(cityName), `overview does not list ${cityName}`);
      assert(overview.includes(genreName), `overview does not list ${genreName}`);
      return `${cityName} + ${genreName}`;
    });

    await check("the schedule survives a save and a reload", async () => {
      await go(app, "/app/settings");
      const hour = app.locator("#digest_send_hour");
      const before = await hour.inputValue();
      const target = before === "9" ? "18" : "9";
      await hour.selectOption(target);
      await submit(app, app.getByRole("button", { name: "Save", exact: true }));
      await go(app, "/app/settings");
      const after = await app.locator("#digest_send_hour").inputValue();
      assert(after === target, `expected hour ${target}, found ${after}`);
      await shot(app, "settings-saved");
      return `${before} → ${after}`;
    });

    await check("pausing the digest shows the warning on the overview", async () => {
      await go(app, "/app/settings");
      const toggle = app.locator("input[name=digest_enabled]");
      await toggle.uncheck();
      await submit(app, app.getByRole("button", { name: "Save", exact: true }));
      await go(app, "/app");
      const text = await app.locator("main").innerText();
      assert(/pause|paused|暫停/i.test(text), "no paused notice after disabling the digest");
      await go(app, "/app/settings");
      await app.locator("input[name=digest_enabled]").check();
      await submit(app, app.getByRole("button", { name: "Save", exact: true }));
      assert(
        await app.locator("input[name=digest_enabled]").isChecked(),
        "the digest did not come back on",
      );
    });

    await check("my feed renders a list or explains the empty week", async () => {
      await go(app, "/app/feed");
      const text = await app.locator("main").innerText();
      const cards = await app.locator("main ul > li").count();
      assert(cards > 0 || /nothing this week|not been/i.test(text), "neither shows nor an empty state");
      await shot(app, "feed");
      return cards > 0 ? `${cards} shows` : "empty week, explained";
    });

    await check("pinning a show from a search puts it on Pinned", async () => {
      await go(app, "/explore");
      await app.getByRole("button", { name: /Show me this week/i }).click();
      await app.waitForFunction(
        () => !document.body.innerText.includes("Searching…"),
        undefined,
        { timeout: 90_000 },
      );
      const pins = app.getByRole("button", { name: "Pin", exact: true });
      if ((await pins.count()) === 0) return "skip: the default search returned no shows to pin";

      const card = app.locator("ul > li").filter({ has: pins.first() }).first();
      const title = (await card.locator("h3, a, strong").first().innerText()).trim();
      await pins.first().click();
      await app.getByRole("button", { name: "Pinned", exact: true }).first().waitFor({ timeout: 20_000 });
      await shot(app, "explore-pinned");

      await go(app, "/app/pinned");
      const pinnedText = await app.locator("main").innerText();
      assert(pinnedText.includes(title), `Pinned does not list ${title}`);
      await shot(app, "pinned");

      // And back out again, so the page ends where it started.
      await app.getByRole("button", { name: "Pinned", exact: true }).first().click();
      await app.waitForTimeout(1500);
      await go(app, "/app/pinned");
      const afterUnpin = await app.locator("main").innerText();
      assert(
        !afterUnpin.includes(title) || /nothing pinned/i.test(afterUnpin),
        "unpinning left the show on the page",
      );
      return title.slice(0, 40);
    });

    await check("the app switches to Chinese and back", async () => {
      await go(app, "/app");
      await app.getByRole("group", { name: "Language" }).getByRole("link").first().click();
      await app.waitForLoadState("load");
      await app.getByRole("navigation").getByRole("link", { name: "總覽" }).waitFor({ timeout: 15_000 });
      await shot(app, "app-zh");
      await app.getByRole("group", { name: "Language" }).getByRole("link").first().click();
      await app.getByRole("navigation").getByRole("link", { name: "Overview" }).waitFor({ timeout: 15_000 });
    });

    await check("signing out closes the app", async () => {
      await go(app, "/app");
      await app.getByRole("button", { name: /Sign out|登出/ }).click();
      await app.waitForLoadState("load");
      await go(app, "/app");
      assert(path(app).startsWith("/login"), `still reachable at ${path(app)}`);
    });

    await check("deleting the account takes the session with it", async () => {
      await signIn(app);
      await app.waitForURL(`${BASE}/app`, { timeout: 30_000 });
      await go(app, "/app/settings");
      await app.getByRole("button", { name: /Delete my account/i }).click();
      const confirm = app.locator("#confirm");
      await confirm.waitFor();
      const submitButton = app.getByRole("button", { name: /Delete permanently/i });
      assert(!(await submitButton.isEnabled()), "delete was armed before the word was typed");
      await confirm.fill("DELETE");
      await shot(app, "settings-delete");
      await submit(app, submitButton);
      await app.waitForURL(`${BASE}/`, { timeout: 30_000 });
      await go(app, "/app");
      assert(path(app).startsWith("/login"), `still signed in at ${path(app)}`);

      const { data } = await admin.auth.admin.getUserById(userId);
      assert(!data.user, "the auth row outlived the deletion");
      userId = "";
      return "account and session gone";
    });

    await authed.close();
  } finally {
    await browser.close();
    if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
  }

  const failed = results.filter((result) => result.outcome === "fail");
  const skipped = results.filter((result) => result.outcome === "skip");
  console.log(
    `\n${results.length - failed.length - skipped.length} passed · ${skipped.length} skipped · ${failed.length} failed`,
  );
  if (skipped.length) {
    console.log("\nskipped");
    for (const result of skipped) console.log(`  ○ ${result.name} — ${result.detail}`);
  }
  if (failed.length) {
    console.log("\nfailed");
    for (const result of failed) console.log(`  ✗ ${result.name}\n      ${result.detail}`);
  }
  if (noise.length) {
    console.log(`\nbrowser console (${noise.length})`);
    for (const line of [...new Set(noise)].slice(0, 40)) console.log(`  · ${line}`);
  }
  console.log(`\nscreenshots in ${SHOTS}`);

  process.exitCode = failed.length ? 1 : 0;
}

main().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
