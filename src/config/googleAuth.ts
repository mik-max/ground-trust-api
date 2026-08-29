import { OAuth2Client } from "google-auth-library";

let client: OAuth2Client | null = null;

// Lazy, same pattern as the other optional-credential configs in this
// project. Note: verifying an ID token only needs the client ID (used as
// the expected `audience` when checking the token's signature against
// Google's public keys) — GOOGLE_CLIENT_SECRET is not used by this flow at
// all. It's only needed for the server-side authorization-code exchange,
// which this project doesn't use (the frontend gets an ID token directly
// via Google Identity Services and sends it here to be verified).
export function getGoogleClient(): OAuth2Client | null {
  if (!process.env.GOOGLE_CLIENT_ID) return null;
  if (!client) client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  return client;
}
