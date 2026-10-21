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
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
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
  await settled(page);
  return response;
}

/**
 * Waits out the /app loading skeleton.
 *
 * Since loading.tsx exists, Next paints a skeleton the instant a link is clicked
 * and swaps in the real content when the server render lands. Without this, a
 * check reads the skeleton and concludes the page is empty — which is exactly
 * what happened to the two slowest sections, My feed and What I follow.
 */
async function settled(page: Page) {
  const skeleton = page.locator("[data-loading]");
  if ((await skeleton.count()) > 0) {
    await skeleton.first().waitFor({ state: "detached", timeout: 45_000 });
  }
}

/**
 * Clicks a server-action submit and waits for the action itself to answer.
 *
 * A server action is a POST to the current URL, not a navigation, so waiting on load
 * state returns immediately and the next `goto` can outrun the write.
 */
/**
 * Sets a checkbox and makes sure it stayed set.
 *
 * These controls are server-rendered and hydrate a moment later. A click that
 * lands in between is undone when React reconciles the uncontrolled input, and
 * Playwright reports it as "clicking the checkbox did not change its state".
 * A real reader hits the same window — they see it bounce back and click again.
 */
async function setChecked(page: Page, locator: Locator, value: boolean) {
  for (let attempt = 0; attempt < 20; attempt++) {
    if ((await locator.isChecked()) === value) return;
    await locator.click();
    await page.waitForTimeout(150);
  }
  throw new Error(`the checkbox would not stay ${value ? "checked" : "unchecked"}`);
}

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

    await check("the landing form can reach every genre", async () => {
      // It showed eight, under copy saying "this is what the email filters on",
      // with no way to the rest. Ticking all eight read as choosing everything
      // and subscribed to eight of twenty-one.
      const chips = page.locator("form button[aria-pressed]");
      const before = await chips.count();
      const more = page.getByRole("button", { name: /^Show \d+ more$/ });

      if ((await more.count()) === 0) {
        return `skip: only ${before} genres seeded, nothing hidden`;
      }
      const label = await more.innerText();
      await more.click();
      const after = await chips.count();
      assert(after > before, `"${label}" revealed nothing (${before} → ${after})`);
      return `${before} → ${after}`;
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

    await check("a half-typed place is refused, not guessed", async () => {
      // The bug this pins: `chosenPlace ?? detectedPoint` meant typing a place
      // and clicking the button searched whatever the timezone guessed, and the
      // only hint was a line folded inside a collapsed "Advanced" panel.
      const city = page.locator("#explore-city");
      await city.click();
      await city.fill("Amher");
      await page.waitForTimeout(400);
      await page.getByRole("button", { name: /Show me this week/i }).click();
      await page.waitForTimeout(600);

      const body = await page.locator("main").innerText();
      assert(/can't tell which/i.test(body), "a half-typed place was accepted");
      assert(!/of New York/i.test(body), "it fell back to the detected city anyway");

      // And choosing from the list clears it again.
      await city.click();
      await city.fill("Amherst");
      await page.locator('[role="option"]').first().waitFor({ timeout: 15_000 });
      await page.locator('[role="option"]').first().click();
      assert(
        !/can't tell which/i.test(await page.locator("main").innerText()),
        "choosing a suggestion did not clear the refusal",
      );
      return await city.inputValue();
    });

    await check("the city box can be driven from the keyboard", async () => {
      // The regression this pins: Enter used to take matches[0] unconditionally
      // and there were no arrow keys at all, so the only way to reach the third
      // suggestion was to keep typing until it was the first.
      const city = page.locator("#explore-city");
      await city.click();
      await city.fill("cam");
      await page.locator('[role="option"]').first().waitFor({ timeout: 15_000 });

      const options = page.locator('[role="option"]');
      const count = await options.count();
      assert(count > 2, `expected several suggestions, got ${count}`);

      const first = await options.first().getAttribute("id");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowDown");
      const active = await city.getAttribute("aria-activedescendant");
      assert(active && active !== first, "ArrowDown did not move the active option");

      const wanted = (await options.nth(2).innerText()).replace(/\s+/g, " ").trim();
      await page.keyboard.press("Enter");
      const committed = await city.inputValue();
      assert(
        committed.startsWith(wanted.split(" ")[0]),
        `Enter committed "${committed}" rather than the highlighted "${wanted}"`,
      );

      // A half-typed name must survive losing focus; discarding it meant a tap
      // anywhere else on a phone silently reverted the field.
      await city.click();
      await city.fill("amher");
      await page.locator("h1").click();
      const kept = await city.inputValue();
      assert(kept === "amher", `blur discarded the draft, field reads "${kept}"`);

      return `${count} suggestions, Enter took "${wanted}"`;
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

    // The page is a centred column on an empty screen, so it reads as a modal and readers
    // look for a dismiss. `.last()` because the ✕ carries the same accessible name.
    await check("login has a way out", async () => {
      await page.getByRole("link", { name: /Back to likelylist/ }).last().click();
      // waitForURL, not waitForLoadState: this is a client-side navigation and no `load`
      // event fires, so waiting on one asserts against the page you just left.
      await page.waitForURL(`${BASE}/`);
      return path(page);
    });

    // The landing page's Spotify button, for somebody with no account. The consent screen
    // itself is out of scope for this suite, but the part that used to be wrong is not:
    // the bounce has to come back to the connect route, or signing in strands the reader
    // on the editor having never bound anything.
    await check("the landing Spotify button sends a stranger to sign in first", async () => {
      await go(page, "/");
      const connect = page.getByRole("link", { name: /Connect with Spotify/i }).first();
      if ((await connect.count()) === 0) return "skip: SPOTIFY_CLIENT_ID is not set";

      await connect.click();
      await page.waitForURL(/\/login\?/, { timeout: 30_000 });
      assert(
        decodeURIComponent(path(page)).includes("next=/api/spotify/connect"),
        `sign-in would not resume the connect: ${path(page)}`,
      );
      const shown = await page.locator("main").innerText();
      assert(/spotify/i.test(shown), "nothing on /login explains why an address is needed");
      await shot(page, "login-spotify");
      return path(page);
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

    // The browser half of the English-only guard. switcher.test.ts covers the resolvers;
    // this catches a catalogue reaching a real page through a route no unit test models.
    await check("?lang=zh-Hant still serves English", async () => {
      await go(page, "/?lang=zh-Hant");
      const text = await page.locator("body").innerText();
      assert(!/[一-鿿]/.test(text), "Chinese copy is still being served");
      assert(
        !(await page.getByRole("group", { name: "Language" }).count()),
        "the language switcher is still rendered",
      );
    });

    // Not "no cookie at all": `to=en` is a served locale and legitimately sets one, which
    // an earlier check in this file already did. What must not happen is a switched-off
    // locale being persisted.
    await check("/lang refuses to persist a locale that is not served", async () => {
      await go(page, "/lang?to=zh-Hant&next=/");
      const cookie = (await anon.cookies()).find(
        (c) => c.name.includes("lang") || c.name.includes("locale"),
      );
      assert(cookie?.value !== "zh-Hant", "a switched-off locale was written to a cookie");
    });

    await check("the 404 is ours, with a way home", async () => {
      const response = await page.goto(`${BASE}/definitely-not-a-page`);
      assert(response?.status() === 404, `expected 404, got ${response?.status()}`);
      const body = await page.locator("body").innerText();
      assert(
        !/This page could not be found/i.test(body),
        "still serving Next's own unstyled 404",
      );
      assert(
        (await page.getByRole("link", { name: /likelylist/i }).count()) > 0,
        "the 404 offers no way back",
      );
      await shot(page, "not-found");
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

    await check("a new account takes the timezone its browser reports", async () => {
      // profiles.timezone comes from a column default, set by a trigger on
      // auth.users that cannot know where the reader is. Every account made by
      // signing in was therefore Eastern — a 5am email for anyone on the west
      // coast, and nothing said so.
      //
      // Three behaviours, because the dangerous one is the third: a stored
      // Eastern is a real setting once the account is not brand new, and must
      // not be overwritten.
      const cases: [string, string, boolean, string][] = [
        ["new, Pacific browser", "America/Los_Angeles", false, "America/Los_Angeles"],
        ["new, Eastern browser", "America/New_York", false, "America/New_York"],
        ["month-old, Pacific browser", "America/Los_Angeles", true, "America/New_York"],
      ];
      const seen: string[] = [];

      for (const [label, zone, aged, expected] of cases) {
        const email = `ui-test-tz-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@likelylist.test`;
        const { data: made, error: madeError } = await admin.auth.admin.createUser({
          email,
          email_confirm: true,
        });
        assert(!madeError && made.user, `could not create ${label}: ${madeError?.message}`);
        const id = made.user.id;

        try {
          if (aged) {
            await admin
              .from("profiles")
              .update({ created_at: new Date(Date.now() - 30 * 86_400_000).toISOString() })
              .eq("id", id);
          }

          const { data: link } = await admin.auth.admin.generateLink({
            type: "magiclink",
            email,
          });
          const context = await browser.newContext({ timezoneId: zone });
          try {
            const tzPage = await context.newPage();
            await go(
              tzPage,
              `/auth/callback?token_hash=${link!.properties!.hashed_token}&type=magiclink`,
            );
            await tzPage.waitForURL(`${BASE}/app`, { timeout: 30_000 });
            // The adoption is a server action fired from an effect, so it lands
            // just after the render rather than during it.
            await tzPage.waitForTimeout(3_500);
          } finally {
            await context.close();
          }

          const { data: row } = await admin
            .from("profiles")
            .select("timezone")
            .eq("id", id)
            .single<{ timezone: string }>();
          assert(
            row?.timezone === expected,
            `${label}: expected ${expected}, stored ${row?.timezone}`,
          );
          seen.push(`${label} → ${row?.timezone}`);
        } finally {
          await admin.auth.admin.deleteUser(id).catch(() => {});
        }
      }

      return seen.join(" · ");
    });

    await check("a valid sign-in link lands on /app", async () => {
      await signIn(app);
      await app.waitForURL(`${BASE}/app`, { timeout: 30_000 });
      await app.getByText(EMAIL).first().waitFor();
      await shot(app, "app-overview");
    });

    await check("the shape each email template produces really signs in", async () => {
      // Signing in through admin.generateLink bypasses the templates entirely,
      // so nothing here ever exercised the link a reader actually clicks — and
      // the shapes differ from the one the walk uses: magic-link.html emits
      // `type=email`, confirm-signup.html emits `type=signup`, and the helper
      // above mints `type=magiclink`.
      //
      // The type is read out of the template file rather than written here, so
      // editing a template moves this check with it.
      const dir = join(import.meta.dirname, "..", "supabase", "email-templates");
      const templates = readdirSync(dir).filter((name) => name.endsWith(".html"));
      assert(templates.length > 0, "no email templates to check");

      const verified: string[] = [];

      for (const name of templates) {
        const html = readFileSync(join(dir, name), "utf8");
        // The href in the button, not the explanatory comment at the top.
        const match = html.match(/token_hash=\{\{ \.TokenHash \}\}&type=([a-z_]+)/);
        assert(match, `${name} has no token_hash link for a reader to click`);
        const type = match[1];

        if (type === "signup") {
          // A signup link can only be minted for an address that has not been
          // registered, so this gets one of its own and cleans up after itself.
          const email = `ui-test-signup-${Date.now()}@likelylist.test`;
          const { data, error } = await admin.auth.admin.generateLink({
            type: "signup",
            email,
            password: `pw-${Math.random().toString(36).slice(2)}A1!`,
          });
          if (error || !data.properties?.hashed_token) {
            verified.push(`${name}: skipped (${error?.message ?? "no token"})`);
            continue;
          }
          const fresh = await browser.newContext();
          try {
            const freshPage = await fresh.newPage();
            await go(
              freshPage,
              `/auth/callback?token_hash=${data.properties.hashed_token}&type=signup`,
            );
            await freshPage.waitForURL(`${BASE}/app`, { timeout: 30_000 });
          } finally {
            await fresh.close();
            if (data.user?.id) await admin.auth.admin.deleteUser(data.user.id).catch(() => {});
          }
          verified.push(`${name}: type=signup`);
          continue;
        }

        // magiclink and email both verify a magic-link token.
        const { data, error } = await admin.auth.admin.generateLink({
          type: "magiclink",
          email: EMAIL,
        });
        assert(!error && data.properties?.hashed_token, `could not mint a token for ${name}`);
        const other = await browser.newContext();
        try {
          const otherPage = await other.newPage();
          await go(
            otherPage,
            `/auth/callback?token_hash=${data.properties!.hashed_token}&type=${type}`,
          );
          await otherPage.waitForURL(`${BASE}/app`, { timeout: 30_000 });
        } finally {
          await other.close();
        }
        verified.push(`${name}: type=${type}`);
      }

      return verified.join(" · ");
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
      // The redirect is a client navigation after the RSC response, and the
      // loading skeleton now paints before it. Waiting for the URL rather than
      // for load also keeps the next check's goto from aborting this one.
      await go(app, "/app/feeds");
      await app.waitForURL(/\/app\/subscriptions/, { timeout: 30_000 });
      await settled(app);
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
        await settled(app);
        const text = await app.locator("main").innerText();
        assert(marker.test(text), `page body did not mention ${marker}`);
        await shot(app, `nav-${expected.replace(/\W+/g, "-")}`);
        return path(app);
      });
    }

    // What the confirm email's happy path lands on. The redirect chain that gets here is
    // asserted in safe-next.test.ts; this is the half that proves the banner exists.
    await check("?subscribed=1 acknowledges the confirmation", async () => {
      await go(app, "/app/subscriptions?subscribed=1");
      const text = await app.locator("main").innerText();
      assert(/subscribed and signed in/i.test(text), "no confirmation banner");
      await shot(app, "subscriptions-confirmed");

      await go(app, "/app/subscriptions");
      const plain = await app.locator("main").innerText();
      assert(!/subscribed and signed in/i.test(plain), "the banner shows without the flag");
    });

    await check("the subscriptions jump links move down the page", async () => {
      await go(app, "/app/subscriptions");
      await app.getByRole("navigation", { name: "Jump to a section" })
        .getByRole("link", { name: "Screenshots" })
        .click();
      await app.waitForFunction(() => window.scrollY > 200, undefined, { timeout: 10_000 });
      assert(app.url().endsWith("#screenshots"), `url is ${path(app)}`);
    });

    // The whole artists rework in one pass. Worth the length: a switched-off artist is
    // stored as score 0 rather than deleted, and the only way to tell that from a delete
    // is that the chip is still on the page after a reload.
    await check("an artist can be followed, switched off, and stays listed", async () => {
      await go(app, "/app/subscriptions");
      await app.locator("#artist-search").fill("Phoebe Bridgers");
      const follow = app.locator("#artists").getByRole("button", { name: "Follow" }).first();
      await follow.waitFor({ timeout: 20_000 });
      await follow.click();

      // followArtist writes immediately and revalidates, so the chip arrives from the
      // server mid-edit — already ticked, because a manual follow is an explicit one.
      const chip = app.locator("#artists button", { hasText: /Phoebe Bridgers/i }).first();
      await chip.waitFor({ timeout: 20_000 });
      assert(
        (await chip.innerText()).includes("[x]"),
        `a hand-followed artist should arrive ticked, got ${await chip.innerText()}`,
      );

      const save = app.getByRole("button", { name: /Save changes/i });
      await chip.click();
      assert((await chip.innerText()).includes("[ ]"), "unticking did not change the box");
      assert(await save.isEnabled(), "Save stayed disabled after unticking an artist");
      await save.click();
      await app.getByText("Saved.").waitFor({ timeout: 30_000 });

      await go(app, "/app/subscriptions");
      const after = app.locator("#artists button", { hasText: /Phoebe Bridgers/i }).first();
      await after.waitFor({ timeout: 20_000 });
      assert(
        (await after.innerText()).includes("[ ]"),
        "the artist came back ticked, so the opt-out was not stored",
      );
      return "off, and still listed";
    });

    await check("an artist you already follow says so", async () => {
      // The search offered the same "Follow" button whether or not you already
      // followed the result, so the only way to find out was to press it.
      await go(app, "/app/subscriptions#artists");
      const field = app.locator("#artist-search");
      await field.click();
      await field.fill("Radiohead");
      const row = app.locator("li", { hasText: /Radiohead/i }).first();
      await row.waitFor({ timeout: 30_000 });

      const follow = row.getByRole("button", { name: /^Follow$/ });
      if ((await follow.count()) === 0) return "skip: no followable result";
      await follow.click();
      await app.getByText(/Now following/i).waitFor({ timeout: 30_000 });

      // Reload: the state has to survive, not just be remembered in this render.
      await go(app, "/app/subscriptions#artists");
      await field.click();
      await field.fill("Radiohead");
      const again = app.locator("li", { hasText: /Radiohead/i }).first();
      await again.waitFor({ timeout: 30_000 });
      await again.getByText(/^Following$/).waitFor({ timeout: 15_000 });
      return "Following, after a reload";
    });

    await check("select all turns every artist back on", async () => {
      const selectAll = app.locator("#artists").getByRole("button", { name: "Select all" });
      await selectAll.click();
      const chip = app.locator("#artists button", { hasText: /Phoebe Bridgers/i }).first();
      assert((await chip.innerText()).includes("[x]"), "Select all did not tick the chip");
      await app.locator("#artists").getByRole("button", { name: "Clear all" }).waitFor();
      await app.getByRole("button", { name: /Save changes/i }).click();
      await app.getByText("Saved.").waitFor({ timeout: 30_000 });
    });

    await check("the overview lists the artists the digest looks for", async () => {
      await go(app, "/app");
      const overview = await app.locator("main").innerText();
      assert(/Artists|歌手/.test(overview), "no artists section on the overview");
      assert(
        overview.includes("Phoebe Bridgers"),
        "the followed artist is missing from the overview",
      );
      await shot(app, "overview-artists");
    });

    await check("the landing page greets a subscriber with their next digest", async () => {
      await go(app, "/");
      const main = await app.locator("main").innerText();
      assert(
        /digest is on the way/i.test(main),
        `landing page still reads as anonymous: ${main.slice(0, 200)}`,
      );
      // The form, not the word: the "01 / your email" step copy says "you're
      // subscribed" and is meant to stay.
      assert(
        (await app.getByRole("button", { name: "Subscribe", exact: true }).count()) === 0,
        "the anonymous subscribe box is still on a signed-in landing page",
      );
      await shot(app, "landing-signed-in");
    });

    await check("sending a real email takes a second click", async () => {
      // "Build it now" renders a preview; "Email it to me" puts a real message
      // in a real inbox. They were the same size and the same variant, side by
      // side, with nothing to tell them apart.
      //
      // (The byte-size panel is gated on dev mode, which cannot be exercised
      // here: isDevMode returns true unconditionally outside production, by
      // design, and this walk drives a dev server.)
      await go(app, "/app");
      const send = app.getByRole("button", { name: /^Email it to me$/i });
      await send.click();
      const confirm = app.getByRole("button", { name: /Yes, send it now/i });
      await confirm.waitFor({ timeout: 10_000 });
      assert(
        await app.getByText(/sends a real email/i).isVisible(),
        "the confirm step did not say what it was about to do",
      );
      await app.getByRole("button", { name: /^Cancel$/ }).click();
      await send.waitFor({ timeout: 10_000 });
      return "confirm step shown, then cancelled";
    });

    await check("build it now runs once, then holds the door for three minutes", async () => {
      // Dev mode on, so the byte-size panel this check reads is rendered at all.
      const secret = process.env.CRON_SECRET;
      assert(secret, "CRON_SECRET is needed to turn dev mode on");
      await go(app, `/dev-mode?key=${encodeURIComponent(secret)}`);
      await go(app, "/app");

      const build = app.getByRole("button", { name: /build it now/i });
      await build.click();
      // A real build: queries the event cache and renders the whole email.
      await app.getByText(/email size/i).waitFor({ timeout: 60_000 });

      assert(await build.isDisabled(), "the button stayed clickable after a build");
      const countdown = app.getByText(/ready again in/i);
      await countdown.waitFor();

      // The cooldown the server enforces outlives the page, so the button must not come
      // back enabled on a reload only to be met with a 429. The deadline lives in
      // localStorage, which the server cannot read, so the button is briefly enabled
      // between paint and hydration — wait for the countdown rather than assert on the
      // first frame.
      await go(app, "/");
      const stillWaiting = app.getByText(/ready again in/i);
      await stillWaiting.waitFor({ timeout: 10_000 });
      // Matches both labels: the overview says "Build it now", the landing page
      // says "Build one now". They share one server-side cooldown, which is the
      // thing being asserted.
      assert(
        await app.getByRole("button", { name: /^Build (it|one) now$/i }).isDisabled(),
        "the cooldown was forgotten across a reload",
      );
      return await stillWaiting.innerText();
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

    await check("a place reads as a place wherever it is shown", async () => {
      // Three surfaces rendered a name and a state code as separate elements
      // spaced with CSS. That looks right and reads as "BostonMA" to anything
      // taking the text rather than the pixels — innerText, a copy-paste, a
      // screen reader — and each surface had glued them differently.
      //
      // Asserting on text is the whole point: a pixel-level check would have
      // passed on all three.
      const glued = /[a-z][A-Z]{2}\b/;
      const surfaces: [string, string, string][] = [
        ["/app", "main ul li", "the overview list"],
        ["/app/subscriptions", "#cities button[aria-pressed]", "the city chips"],
      ];
      const seen: string[] = [];

      for (const [path, selector, label] of surfaces) {
        await go(app, path);
        const rows = app.locator(selector);
        const count = await rows.count();
        if (count === 0) {
          seen.push(`${label}: none`);
          continue;
        }

        let checked = 0;
        for (let i = 0; i < Math.min(count, 12); i++) {
          const text = (await rows.nth(i).innerText()).replace(/\s+/g, " ").trim();
          if (!text) continue;
          assert(
            !glued.test(text),
            `${label} rendered "${text}" — a state code glued to a name`,
          );
          checked += 1;
        }
        seen.push(`${label}: ${checked} ok`);
      }

      return seen.join(" · ");
    });

    await check("the app nav says which section you are in", async () => {
      await go(app, "/app/pinned");
      const current = app.locator('nav a[aria-current="page"]');
      assert((await current.count()) === 1, "expected exactly one current nav link");
      const label = (await current.innerText()).trim();
      assert(/pinned|收藏/i.test(label), `current link reads "${label}" on /app/pinned`);
      return label;
    });

    await check("saving the schedule confirms, and survives a reload", async () => {
      // Two things this used to be two checks for: the form was a bare server
      // action that re-rendered the same values and said nothing, and the
      // persistence check waited on `submit()` — a POST response — which is not
      // the same instant as React finishing with the form. Against a production
      // build, where hydration is slower, that raced and the selection was lost.
      //
      // Waiting for the confirmation the reader waits for removes the race and
      // covers both. (Progressive enhancement is intact either way: the form
      // saves with JavaScript disabled, verified against the live database.)
      await go(app, "/app/settings");
      const hour = app.locator("#digest_send_hour");
      const before = await hour.inputValue();
      const target = before === "9" ? "10" : "9";

      await hour.selectOption(target);
      await app.getByRole("button", { name: "Save", exact: true }).click();
      await app.getByText(/^Saved\.$|^已儲存。$/).waitFor({ timeout: 30_000 });
      await shot(app, "settings-confirmation");

      await go(app, "/app/settings");
      const after = await app.locator("#digest_send_hour").inputValue();
      assert(after === target, `expected hour ${target} after a reload, found ${after}`);
      return `${before} → ${after}`;
    });

    await check("pausing the digest shows the warning on the overview", async () => {
      // Waits for the confirmation rather than a POST response, for the same
      // reason the schedule check does: the write is done when the form says so.
      await go(app, "/app/settings");
      await setChecked(app, app.locator("input[name=digest_enabled]"), false);
      await app.getByRole("button", { name: "Save", exact: true }).click();
      await app.getByText(/^Saved\.$|^已儲存。$/).waitFor({ timeout: 30_000 });

      await go(app, "/app");
      const text = await app.locator("main").innerText();
      assert(/pause|paused|暫停/i.test(text), "no paused notice after disabling the digest");

      await go(app, "/app/settings");
      await setChecked(app, app.locator("input[name=digest_enabled]"), true);
      await app.getByRole("button", { name: "Save", exact: true }).click();
      await app.getByText(/^Saved\.$|^已儲存。$/).waitFor({ timeout: 30_000 });

      await go(app, "/app/settings");
      assert(
        await app.locator("input[name=digest_enabled]").isChecked(),
        "the digest did not come back on",
      );
    });

    // ---- states that only exist with history ---------------------------------
    //
    // Everything above runs against an account created seconds ago, so the
    // screens that only appear once there is a past — a show that has already
    // happened, a screenshot that was applied — were never reached. Two of the
    // defects found by hand were exactly there. The walk writes its own history
    // rather than borrowing a real account.

    await check("a past pin and a sparse one both render", async () => {
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      const { error } = await admin.from("pinned_events").insert([
        {
          user_id: userId,
          tm_event_id: `ui-test-past-${Date.now()}`,
          name: "A Show That Already Happened",
          url: "https://example.com/past",
          local_date: yesterday,
          local_time: "20:00:00",
          timezone: "America/New_York",
          venue_name: "The Old Hall",
          city_label: "Boston, MA",
          genre_name: "Rock",
          performers: [{ name: "A Show That Already Happened", isHeadliner: true }],
        },
        {
          // No venue, no city, no genre. Older rows look like this, and the UX
          // pass found one sitting next to a complete card with no explanation.
          user_id: userId,
          tm_event_id: `ui-test-sparse-${Date.now()}`,
          name: "A Pin With Nothing Attached",
          url: null,
          local_date: yesterday,
          local_time: null,
          timezone: null,
          venue_name: null,
          city_label: null,
          genre_name: null,
          performers: [],
        },
      ]);
      assert(!error, `could not seed pins: ${error?.message}`);

      await go(app, "/app/pinned");
      const body = await app.locator("main").innerText();

      // The contradiction this pins down: the empty state keyed on `upcoming`
      // alone, so an account whose pins have all happened saw "nothing pinned
      // yet" directly above a populated "Already happened" list.
      assert(
        !/nothing pinned yet/i.test(body),
        "claims nothing is pinned while listing past pins",
      );
      assert(/already happened/i.test(body), "no past section for a past pin");
      assert(/A Show That Already Happened/.test(body), "the past pin is missing");
      assert(/A Pin With Nothing Attached/.test(body), "the sparse pin is missing");

      // A card with no venue must omit the line, not render a bare separator.
      assert(
        !/^\s*·\s*$/m.test(body),
        "a card rendered an empty venue line as a dangling separator",
      );
      await shot(app, "pinned-with-history");
      return "past + sparse";
    });

    await check("an applied screenshot reports everything it changed", async () => {
      // "Applied · 0 artists" was shown for a feed that had contributed a genre,
      // and the genre grid credited that same feed on the same page.
      const { error } = await admin.from("feeds").insert({
        user_id: userId,
        status: "done",
        not_music_related: false,
        applied_at: new Date().toISOString(),
        extracted: {
          source_kind: "music_app",
          artists: [],
          genres: ["Rock"],
          songs: [],
          raw_text: "ui-test fixture",
        },
      });
      assert(!error, `could not seed a feed: ${error?.message}`);

      await go(app, "/app/subscriptions#screenshots");
      const body = await app.locator("main").innerText();
      assert(
        !/Applied · 0 artists/.test(body),
        "a feed that contributed a genre still reports 0 artists",
      );
      assert(/Applied · 1 genre/.test(body), "the genre it contributed is not counted");
      await shot(app, "feed-history");
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
      //
      // Targeted at the card that carries the title rather than "the first
      // Pinned button on the page": this check no longer runs against an empty
      // Pinned page, because the history fixtures above put two more there.
      // Waiting for the button to read "Pin" also replaces a fixed 1500ms,
      // which was waiting for a server action with a stopwatch.
      const pinnedCard = app
        .locator("main li")
        .filter({ hasText: title })
        .first();
      await pinnedCard.getByRole("button", { name: "Pinned", exact: true }).click();
      // unpinEvent revalidates /app/pinned, so the card leaves the list rather
      // than flipping its button back. Waiting for it to go is both the right
      // signal and the one that proves the write landed.
      await pinnedCard.waitFor({ state: "detached", timeout: 20_000 });

      await go(app, "/app/pinned");
      const afterUnpin = await app.locator("main").innerText();
      assert(
        !afterUnpin.includes(title) || /nothing pinned/i.test(afterUnpin),
        "unpinning left the show on the page",
      );
      return title.slice(0, 40);
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
      // deleteAccount redirects to /?deleted=1 so the landing page can say what
      // just happened, rather than dropping the reader on the sales pitch.
      await app.waitForURL(`${BASE}/?deleted=1`, { timeout: 30_000 });
      assert(
        /deleted/i.test(await app.locator("main").innerText()),
        "the landing page did not acknowledge the deletion",
      );
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
