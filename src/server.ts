import { createServer } from "node:http";
import { config } from "./config.ts";
import { runMigrations, closeDb } from "./db/client.ts";
import { Router } from "./http/router.ts";
import { buildCtx, type Ctx } from "./http/context.ts";
import { attachSession } from "./http/middleware.ts";
import { parseBody } from "./http/body.ts";
import { tryServeStatic } from "./http/static.ts";
import { ForbiddenError, UnauthorizedError } from "./domain/rbac.ts";
import { InvalidQuoteTransition } from "./domain/quotes.ts";
import { html } from "./views/html.ts";
import { page } from "./views/layout.ts";

import { registerAuthRoutes } from "./http/routes/auth.ts";
import { registerHomeRoutes } from "./http/routes/pages.home.ts";
import { registerFlightSearchRoute } from "./http/routes/pages.search.flights.ts";
import { registerStaySearchRoutes } from "./http/routes/pages.search.stays.ts";
import { registerCruiseSearchRoutes } from "./http/routes/pages.search.cruises.ts";
import { registerPackageSearchRoute } from "./http/routes/pages.search.packages.ts";
import { registerUnconnectedSearchRoutes } from "./http/routes/pages.search.unconnected.ts";
import { registerTripReviewRoutes } from "./http/routes/pages.trip-review.ts";
import { registerCheckoutRoutes } from "./http/routes/pages.checkout.ts";
import { registerAccountRoutes } from "./http/routes/pages.account.ts";
import { registerAgentRoutes } from "./http/routes/agent.ts";
import { registerAdminRoutes } from "./http/routes/admin.ts";

// Migrations run automatically on boot so `npm run dev`/`npm start` always
// has an up-to-date schema without a separate manual step (running them
// again after `npm run migrate` is a fast no-op; see db/client.ts).
runMigrations();

const router = new Router();
registerAuthRoutes(router);
registerHomeRoutes(router);
registerFlightSearchRoute(router);
registerStaySearchRoutes(router);
registerCruiseSearchRoutes(router);
registerPackageSearchRoute(router);
registerUnconnectedSearchRoutes(router);
registerTripReviewRoutes(router);
registerCheckoutRoutes(router);
registerAccountRoutes(router);
registerAgentRoutes(router);
registerAdminRoutes(router);

const server = createServer(async (req, res) => {
  const ctx = buildCtx(req, res);
  try {
    if (tryServeStatic(ctx)) return;
    attachSession(ctx);
    ctx.body = await parseBody(req);
    const match = router.match(ctx.method, ctx.pathname);
    if (!match) {
      return ctx.html(404, page({ title: "Not found", user: ctx.user }, html`<h1>Page not found</h1><p><a href="/">Go home</a></p>`));
    }
    ctx.params = match.params;
    await match.handler(ctx);
  } catch (err) {
    handleError(ctx, err);
  }
});

function handleError(ctx: Ctx, err: unknown) {
  if (err instanceof UnauthorizedError) {
    return ctx.redirect(`/login?next=${encodeURIComponent(ctx.pathname)}`);
  }
  if (err instanceof ForbiddenError) {
    return ctx.html(403, page({ title: "Not authorized", user: ctx.user }, html`<h1>Not authorized</h1><p>${err.message}</p><p><a href="/">Go home</a></p>`));
  }
  if (err instanceof InvalidQuoteTransition) {
    return ctx.html(400, page({ title: "Cannot update quote", user: ctx.user }, html`<h1>Cannot update quote</h1><p>${err.message}</p>`));
  }
  // eslint-disable-next-line no-console
  console.error("[server] Unhandled error:", err);
  ctx.html(500, page({ title: "Something went wrong", user: ctx.user }, html`<h1>Something went wrong</h1><p>An unexpected error occurred. This has been logged.</p>`));
}

server.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`TyJen Travel listening on ${config.appBaseUrl} (NODE_ENV=${config.nodeEnv})`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    server.close();
    closeDb();
    process.exit(0);
  });
}
