// Shared implementation for product types that have a fully designed search
// UI and adapter contract (see types.ts) but no supplier wired up in this
// build: cars, activities, and railway. Per the project requirement, these
// must never present a demonstration result as a live offer, so rather than
// fabricate plausible-looking rows, the search simply returns zero results
// with an honest connection-status explanation the UI renders prominently.
// Swapping in a real adapter later means implementing search()/recheck() the
// way flights/stays/cruises do and registering it here — the calling route
// and view code do not need to change shape.
import { getConnection } from "./registry.ts";
import type { ProductType, UnconnectedSearchResult } from "./types.ts";

export function searchUnconnected<TParams>(productType: ProductType, params: TParams): UnconnectedSearchResult<TParams> {
  const connection = getConnection(productType);
  return { connection, params, results: [] };
}
