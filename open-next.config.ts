import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// No incremental cache override on purpose. The R2-backed cache the OpenNext
// docs show would make R2 a hard dependency, and R2 is not on the Workers Free
// plan. Nothing in this app is statically revalidated — every page is either
// static or per-user dynamic — so the default in-memory cache is enough.
export default defineCloudflareConfig();
