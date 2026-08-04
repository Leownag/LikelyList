/**
 * Type for the OpenNext-generated worker entry.
 *
 * `.open-next/worker.js` is produced by `opennextjs-cloudflare build`, so it does
 * not exist in a clean checkout and `worker.ts` cannot import it type-safely. A
 * wildcard module declaration is used rather than a `@ts-ignore` / `@ts-expect-error`
 * comment because either of those is wrong in one of the two states: `@ts-ignore`
 * trips the lint rule that bans it, and `@ts-expect-error` itself errors once the
 * file *has* been generated — making `npm run typecheck` pass or fail depending on
 * whether a build had happened to run.
 *
 * The generated worker exports only `fetch`; `worker.ts` adds `scheduled` beside it.
 */
declare module "*/.open-next/worker.js" {
  const handler: {
    fetch: (
      request: Request,
      env: unknown,
      ctx: ExecutionContext,
    ) => Promise<Response>;
  };
  export default handler;
}
