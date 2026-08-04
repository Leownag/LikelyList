/**
 * Translates the message catalogue with the OpenAI API.
 *
 *   npm run translate                    # every key with no Traditional Chinese yet
 *   npm run translate -- --write         # ...and put them in zh-Hant.json
 *   npm run translate -- --all --write   # re-translate everything, for a tone pass
 *   npm run translate -- --keys overview.,settings.
 *   npm run translate -- --dry-run
 *
 * Without `--write` it prints the JSON and changes nothing. With it, the translations go
 * straight into src/lib/i18n/messages/zh-Hant.json — which is safe precisely because the
 * catalogue is JSON now: there is no code to break, key order is preserved, and `git diff`
 * is the review step. Nothing is committed, so a bad batch is one `git checkout` away.
 *
 * `fetch` and nothing else. The `openai` package is already a dependency for the vision
 * reader, but it is not needed for one POST, and importing it here would drag a browser-
 * shaped client into a script that runs under tsx.
 *
 * Same model the vision reader uses, so there is one model choice in this project rather
 * than two that drift apart.
 *
 * Two things it deliberately never touches:
 *
 *   - `/privacy`. A translated privacy policy is a legal document in a second language,
 *     and which version governs is not a decision a script makes. It is not in the
 *     catalogue, so it cannot be reached from here.
 *   - Search metadata. Page titles and descriptions for the indexed pages (/, /explore)
 *     are written for search terms, not for readers; translating them would undo that
 *     work. Only the app's own `title.*` keys are in the catalogue, and those pages are
 *     disallowed in robots.ts.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { getMessages } from "../src/lib/i18n/messages";
import type { MessageKey } from "../src/lib/i18n/messages";

/** Written in place, so the file the app reads is the file under review. */
const TARGET = "src/lib/i18n/messages/zh-Hant.json";

const API = "https://api.openai.com/v1/chat/completions";
const MODEL = process.env.OPENAI_TRANSLATE_MODEL ?? process.env.OPENAI_VISION_MODEL ?? "gpt-5.6-luna";

/**
 * What Claude needs to know to translate this copy rather than these words.
 *
 * The product description is here because the strings arrive without context: "Feeds"
 * alone could be an RSS reader, and "on sale" could be a discount. The tone notes matter
 * as much — the English is deliberately plain and slightly dry, and the default register
 * for Chinese UI copy is more formal and more enthusiastic than this product sounds.
 */
const SYSTEM = `You translate UI copy for likelylist, from English into Traditional Chinese as written in Taiwan.

WHAT THE PRODUCT IS
likelylist is a weekly email about live music. Every Friday morning a subscriber gets one
email: which shows go on sale this week, and who is playing near them in the next seven
days. It is filtered by the cities and genres they follow, the artists they name, and
their Spotify listening. Listings come from Ticketmaster, United States only. There is no
password — signing in means clicking a link sent to your inbox. Subscribing needs nothing
but an email address.

WHO READS IT
People who found out about a show after it sold out, or the week after it happened. They
are not enthusiasts managing a tool; they want to stop missing things. Mostly on a phone.

TONE
The English is plain, concrete and a little dry. It states what happens and what it costs,
never oversells, and explains its own limitations openly. Match that. Specifically:
- No exclamation marks. No 喔/唷/囉/呢 and no marketing warmth that is not in the source.
- Prefer 你 over 您. This product speaks to one person, informally.
- Keep it short. Chinese UI copy that is longer than the English usually means the
  translation explained something the English trusted the reader to get.
- Where the English is direct about a downside ("Reading a screenshot is not perfect"),
  stay direct. Do not soften it.
- Use 全形標點（，。：「」）, but do not add a 。 to a fragment or a button label that has
  no full stop in English.
- Render an em dash as —— with a space either side, matching the existing translations in
  this catalogue. Do not turn it into a comma.

TERMS — use these consistently
- digest → 摘要 (the weekly email itself). "the Friday email" → 週五的信
- genre → 類型 (never 流派)
- city / cities → 城市；a town from the wider list → 城鎮
- follow → 追蹤；unfollow / stop following → 取消追蹤
- pinned → 已收藏；pin (verb) → 收藏
- "feed" is TWO different things in this product and they must not be conflated:
    * "My feed" / "the feed" / "your feed" = the page showing this week's shows on screen,
      the Friday email rendered live → 我的清單 / 清單. Never 截圖.
    * "a feed" / "Feeds" as a section / "feed it your music" = a screenshot the reader
      uploads for its artist names → 截圖；the section heading → 截圖來源
  If a string could be either, it is the shows one unless it mentions uploading, reading,
  processing or a screenshot.
- show / gig → 演出；lineup → 卡司；headliner → 主秀；"same bill" → 同場演出
- venue → 場地
- on sale / onsale → 開賣；presale → 預售
- artist → 歌手 for a person, 藝人 when it could be a group
- subscribe → 訂閱；unsubscribe → 退訂
- timezone → 時區
- Keep in English, never translated: likelylist, Ticketmaster, Spotify, YouTube, Apple
  Music, Google Calendar, Cloudflare, ZIP, Census, Supabase, GEOID. Also leave developer
  terms as they are rather than inventing Chinese for them: service role key, RLS, API,
  UTC, cron. These appear in operator-facing warnings where the English term is the
  searchable one.

HARD RULES
- Preserve every {placeholder} exactly, including its braces and spelling. Move it to
  wherever the Chinese sentence needs it.
- Preserve typographic characters that carry meaning: — (em dash), “ ” quotes, … .
- No Markdown, no HTML, no quotes added around the whole string.
- Never translate a placeholder's name, and never invent a new one.
- If a string is a label with no verb ("Cities", "Save"), translate it as a label, not as
  a sentence.

OUTPUT
Reply with one JSON object and nothing else: the same keys you were given, each mapped to
its Traditional Chinese string. No code fence, no commentary.`;

type Args = {
  all: boolean;
  dryRun: boolean;
  write: boolean;
  prefixes: string[];
};

function parseArgs(argv: string[]): Args {
  const keysIndex = argv.indexOf("--keys");
  return {
    all: argv.includes("--all"),
    dryRun: argv.includes("--dry-run"),
    write: argv.includes("--write"),
    prefixes:
      keysIndex >= 0 && argv[keysIndex + 1]
        ? argv[keysIndex + 1].split(",").map((prefix) => prefix.trim())
        : [],
  };
}

/**
 * Which keys to send.
 *
 * "Untranslated" means absent, or identical to the English — which is what a key looks
 * like when it was added to `en` and copied across to satisfy the type. A handful of
 * strings are legitimately identical in both languages (an email placeholder), so
 * `--keys` exists to override this.
 */
export function keysToTranslate(
  en: Record<string, string>,
  zh: Record<string, string>,
  args: Args,
): string[] {
  return Object.keys(en).filter((key) => {
    if (args.prefixes.length > 0) {
      return args.prefixes.some((prefix) => key.startsWith(prefix));
    }
    if (args.all) return true;
    return !zh[key] || zh[key] === en[key];
  });
}

/** Strips a code fence if the model added one anyway, then parses. */
export function parseReply(text: string): Record<string, string> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();

  const parsed = JSON.parse(body) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object of key → translation.");
  }
  return parsed as Record<string, string>;
}

/**
 * The placeholders in a string, as a sorted list.
 *
 * Compared before and after so a dropped or renamed `{count}` is caught here rather than
 * rendering as a literal brace on somebody's settings page.
 */
export function placeholders(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

async function translate(
  entries: Record<string, string>,
  apiKey: string,
): Promise<Record<string, string>> {
  const response = await fetch(API, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      // JSON mode, so the reply cannot arrive wrapped in prose. parseReply still strips a
      // code fence, because that is cheap and this is the kind of guarantee worth not
      // depending on entirely.
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `Translate every value in this object.\n\n${JSON.stringify(entries, null, 2)}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API ${response.status}: ${(await response.text()).slice(0, 400)}`);
  }

  const payload = (await response.json()) as {
    choices: { message?: { content?: string }; finish_reason?: string }[];
  };
  const choice = payload.choices[0];
  if (choice?.finish_reason === "length") {
    throw new Error("The reply was cut off. Translate fewer keys at a time with --keys.");
  }

  return parseReply(choice?.message?.content ?? "");
}

/**
 * Merges translations into the JSON file, keeping its existing key order.
 *
 * Order matters for review: appending new keys at the end would make every batch look like
 * a reordering in `git diff`, and the file is sorted by surface so a reader can find a
 * screen by scrolling. `ensure_ascii` off — the point of this file is to be readable.
 */
function writeInto(target: string, translations: Record<string, string>): number {
  const current = JSON.parse(readFileSync(target, "utf8")) as Record<string, string>;
  let changed = 0;

  for (const [key, value] of Object.entries(translations)) {
    if (current[key] !== value) changed++;
    current[key] = value;
  }

  writeFileSync(target, `${JSON.stringify(current, null, 2)}\n`);
  return changed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const en = getMessages("en") as unknown as Record<MessageKey, string>;
  const zh = getMessages("zh-Hant") as unknown as Record<MessageKey, string>;

  const keys = keysToTranslate(en, zh, args);
  if (keys.length === 0) {
    console.log("Nothing to translate — every key already has Chinese.");
    return;
  }

  const entries = Object.fromEntries(keys.map((key) => [key, en[key as MessageKey]]));
  console.error(`${keys.length} key(s) to translate with ${MODEL}`);

  if (args.dryRun) {
    console.error("--dry-run: not calling the API. Keys:");
    for (const key of keys) console.error(`  ${key}`);
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("OPENAI_API_KEY is not set. It lives in .env.local — run with:");
    console.error("  set -a && . ./.env.local && set +a && npm run translate");
    process.exit(1);
  }

  const translated = await translate(entries, apiKey);

  const missing = keys.filter((key) => !translated[key]);
  if (missing.length > 0) {
    console.error(`WARNING: no translation came back for ${missing.length} key(s):`);
    for (const key of missing) console.error(`  ${key}`);
  }

  // A lost placeholder is the one failure mode that reaches the screen as visible
  // breakage, so it is reported loudly rather than left for review to catch.
  for (const key of keys) {
    const value = translated[key];
    if (!value) continue;
    const before = placeholders(en[key as MessageKey]).join(",");
    const after = placeholders(value).join(",");
    if (before !== after) {
      console.error(`WARNING: ${key} placeholders changed: {${before}} → {${after}}`);
    }
  }

  const usable = Object.fromEntries(
    keys.filter((key) => translated[key]).map((key) => [key, translated[key]]),
  );

  if (args.write) {
    const changed = writeInto(TARGET, usable);
    console.error(`${changed} value(s) written to ${TARGET} — review with git diff.`);
    return;
  }

  console.log(JSON.stringify(usable, null, 2));
  console.error("Nothing written. Re-run with --write to put these in zh-Hant.json.");
}

// Endswith, not includes: the test file's own name contains this one, and `includes`
// meant importing it for a unit test ran the whole script and exited.
if (process.argv[1]?.endsWith("translate-copy.ts")) {
  // Not top-level await: tsx compiles scripts/ to CJS, which has none.
  void main().catch((cause) => {
    console.error(cause instanceof Error ? cause.message : cause);
    process.exit(1);
  });
}
