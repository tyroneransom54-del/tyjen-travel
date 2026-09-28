import type { NormalizedFlightOffer } from "../../adapters/types.ts";

export function parseCityName(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .trim()
    .replace(/^[A-Za-z]{3}\s*[—-]\s*/, "")
    .replace(/\s*\([A-Za-z]{3}\)\s*$/, "")
    .trim();
}

export function parseAirportCode(input: string | null | undefined): string {
  if (!input) return "";
  const trimmed = input.trim();
  const paren = trimmed.match(/\(([A-Za-z]{3})\)\s*$/);
  if (paren) return paren[1]!.toUpperCase();
  if (/^[A-Za-z]{3}$/.test(trimmed)) return trimmed.toUpperCase();
  return trimmed.slice(0, 3).toUpperCase();
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

export function formatClockTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function formatDateLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export type FlightSort = "best" | "price" | "fastest" | "earliest" | "airline" | "layover";

/**
 * "Best overall" combines price, total trip duration, and number of stops
 * into one score so an obviously-cheap-but-terrible itinerary doesn't always
 * win, and an obviously-fast-but-very-expensive one doesn't either. The
 * weighting (and this explanation) is shown on the results page itself per
 * the project requirement to explain how "best overall" is ranked:
 *   score = price_rank * 0.5 + duration_rank * 0.3 + stops_rank * 0.2
 * where each *_rank is the offer's percentile position (0 = best in the
 * result set) on that dimension. Lower score is better.
 */
export function sortFlights(offers: NormalizedFlightOffer[], sort: FlightSort): NormalizedFlightOffer[] {
  const list = [...offers];
  if (list.length === 0) return list;
  if (sort === "price") return list.sort((a, b) => a.totalCents - b.totalCents);
  if (sort === "fastest") return list.sort((a, b) => a.durationMinutes - b.durationMinutes);
  if (sort === "earliest") return list.sort((a, b) => new Date(a.departAt).getTime() - new Date(b.departAt).getTime());
  if (sort === "airline") return list.sort((a, b) => a.marketingAirline.localeCompare(b.marketingAirline));
  if (sort === "layover") return list.sort((a, b) => sumLayovers(a) - sumLayovers(b));

  const byPrice = [...list].sort((a, b) => a.totalCents - b.totalCents);
  const byDuration = [...list].sort((a, b) => a.durationMinutes - b.durationMinutes);
  const byStops = [...list].sort((a, b) => a.stops - b.stops);
  const rank = (arr: NormalizedFlightOffer[], id: string) => arr.findIndex((o) => o.id === id) / Math.max(1, arr.length - 1);
  return list
    .map((o) => ({ o, score: rank(byPrice, o.id) * 0.5 + rank(byDuration, o.id) * 0.3 + rank(byStops, o.id) * 0.2 }))
    .sort((a, b) => a.score - b.score)
    .map((x) => x.o);
}

function sumLayovers(o: NormalizedFlightOffer): number {
  return o.layovers.reduce((sum, l) => sum + l.minutes, 0);
}
