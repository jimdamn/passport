// Test-only entry point. Pages Functions exports `onRequest`, not a plain
// Worker `fetch` handler, so @cloudflare/vitest-pool-workers (which needs a
// `main` module with a default export implementing fetch) has no way to boot
// the real app directly. The Hono instance itself already has a matching
// `.fetch(request, env, ctx)` method, so re-exporting it as default is enough
// - no route logic is duplicated or reimplemented here.
export { app as default } from '../functions/api/[[route]]';
