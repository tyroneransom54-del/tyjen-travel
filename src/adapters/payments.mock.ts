// MOCK payment provider. TyJen Travel never stores real card numbers (see
// LIMITATIONS.md / project requirement 9). This module simulates an
// authorize -> capture flow the way a real processor (Stripe, Adyen, etc.)
// would be used: authorize first, confirm the supplier booking, THEN
// capture; if the supplier booking fails after authorization, void instead
// of capturing so the customer is never charged for an unconfirmed trip.
//
// To make the required "rejected payment" demonstration reproducible without
// a real payments account, this mock declines deterministically when the
// card number ends in "0002" (mirroring the common real-provider convention
// of a dedicated always-declines test card) or when `simulateDecline` is
// explicitly passed by the demo checkout UI.
import { newId } from "../domain/ids.ts";

export interface CardInput {
  cardNumber: string; // demo-only input, never persisted to the database
  expiry: string;
  cvc: string;
  nameOnCard: string;
}

export interface AuthorizeResult {
  ok: boolean;
  providerRef: string;
  failureCode?: "card_declined" | "insufficient_funds" | "invalid_card";
  message: string;
}

export function authorize(amountCents: number, currency: string, card: CardInput, simulateDecline = false): AuthorizeResult {
  const providerRef = `mock_auth_${newId("pi")}`;
  const digitsOnly = card.cardNumber.replace(/\s+/g, "");
  if (simulateDecline || digitsOnly.endsWith("0002")) {
    return {
      ok: false,
      providerRef,
      failureCode: "card_declined",
      message: "The card was declined by the (simulated) issuing bank. No charge was made.",
    };
  }
  if (digitsOnly.endsWith("0069")) {
    return {
      ok: false,
      providerRef,
      failureCode: "insufficient_funds",
      message: "The (simulated) card has insufficient funds. No charge was made.",
    };
  }
  if (digitsOnly.length < 12) {
    return { ok: false, providerRef, failureCode: "invalid_card", message: "That card number does not look valid." };
  }
  return { ok: true, providerRef, message: `Authorized ${(amountCents / 100).toFixed(2)} ${currency}.` };
}

export function capture(providerRef: string): { ok: true; providerRef: string } {
  return { ok: true, providerRef: `mock_capture_${providerRef}` };
}

export function voidAuthorization(providerRef: string): { ok: true; providerRef: string } {
  return { ok: true, providerRef: `mock_void_${providerRef}` };
}

export function refund(providerRef: string): { ok: true; providerRef: string } {
  return { ok: true, providerRef: `mock_refund_${providerRef}` };
}
