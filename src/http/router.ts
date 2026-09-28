import type { IncomingMessage, ServerResponse } from "node:http";
import type { Ctx } from "./context.ts";

export type Handler = (ctx: Ctx) => Promise<void> | void;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

/** Minimal dependency-free path router supporting static segments and
 * ":param" placeholders (e.g. "/agent/clients/:id"). Good enough for this
 * app's route table without pulling in a routing framework. */
export class Router {
  private routes: Route[] = [];

  private add(method: string, path: string, handler: Handler) {
    this.routes.push({ method, segments: path.split("/").filter(Boolean), handler });
  }

  get(path: string, handler: Handler) {
    this.add("GET", path, handler);
  }
  post(path: string, handler: Handler) {
    this.add("POST", path, handler);
  }
  put(path: string, handler: Handler) {
    this.add("PUT", path, handler);
  }
  delete(path: string, handler: Handler) {
    this.add("DELETE", path, handler);
  }

  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | undefined {
    const segments = pathname.split("/").filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== segments.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < route.segments.length; i++) {
        const routeSeg = route.segments[i]!;
        const actual = segments[i]!;
        if (routeSeg.startsWith(":")) {
          params[routeSeg.slice(1)] = decodeURIComponent(actual);
        } else if (routeSeg !== actual) {
          ok = false;
          break;
        }
      }
      if (ok) return { handler: route.handler, params };
    }
    return undefined;
  }
}

export type { IncomingMessage, ServerResponse };
