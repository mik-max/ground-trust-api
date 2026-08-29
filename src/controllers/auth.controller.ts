import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../config/prisma";
import { getGoogleClient } from "../config/googleAuth";
import { Role } from "../generated/prisma";

const SIGNUP_ROLES: Role[] = ["resident", "newcomer"];

function signToken(userId: string, role: Role) {
  return jwt.sign({ userId, role }, process.env.JWT_SECRET as string, {
    expiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  } as jwt.SignOptions);
}

// Government and admin accounts are provisioned separately (see
// admin.controller.ts) — this endpoint only accepts resident/newcomer,
// per files/HANDOFF.md §2.5.
export async function signup(req: Request, res: Response) {
  const { fullName, email, password, role } = req.body;

  if (!fullName || !email || !password || !role) {
    return res.status(400).json({ error: "fullName, email, password, and role are required" });
  }
  if (!SIGNUP_ROLES.includes(role)) {
    return res.status(400).json({ error: "role must be 'resident' or 'newcomer'" });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "An account with this email already exists" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { fullName, email, passwordHash, role, authProvider: "email" },
  });

  const token = signToken(user.id, user.role);
  return res.status(201).json({
    token,
    user: { id: user.id, fullName: user.fullName, email: user.email, role: user.role },
  });
}

export async function login(req: Request, res: Response) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const token = signToken(user.id, user.role);
  return res.json({
    token,
    user: { id: user.id, fullName: user.fullName, email: user.email, role: user.role },
  });
}

// Sign in with Google (files/DESIGN_SYSTEM.md §6.1's "Email/Google auth").
// The frontend gets a signed ID token directly from Google Identity
// Services and sends it here — verified against Google's public keys, no
// authorization-code exchange, so GOOGLE_CLIENT_SECRET is never used (see
// config/googleAuth.ts). `role` is only meaningful for a brand-new
// account — the Register page sends its selected role; the Login page
// omits it, since logging in shouldn't silently create an account.
export async function googleAuth(req: Request, res: Response) {
  const { credential, role } = req.body as { credential?: string; role?: Role };

  if (!credential) {
    return res.status(400).json({ error: "credential is required" });
  }

  const client = getGoogleClient();
  if (!client) {
    return res.status(503).json({ error: "Google sign-in is not configured" });
  }

  let email: string | undefined;
  let fullName: string | undefined;
  try {
    const ticket = await client.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload?.email || !payload.email_verified) {
      return res.status(401).json({ error: "Invalid Google credential" });
    }
    email = payload.email;
    fullName = payload.name ?? payload.email.split("@")[0];
  } catch {
    return res.status(401).json({ error: "Invalid Google credential" });
  }

  let user = await prisma.user.findUnique({ where: { email } });
  let isNewUser = false;

  if (!user) {
    if (!role) {
      return res.status(404).json({ error: "No account found for this Google email — register first" });
    }
    if (!SIGNUP_ROLES.includes(role)) {
      return res.status(400).json({ error: "role must be 'resident' or 'newcomer'" });
    }
    user = await prisma.user.create({
      data: { fullName, email, role, authProvider: "google" },
    });
    isNewUser = true;
  }

  // An existing email/password account signing in with Google on the same,
  // Google-verified email is treated as the same person — this doesn't
  // touch their password or authProvider, it's just an additional way in.

  const token = signToken(user.id, user.role);
  return res.json({
    token,
    user: { id: user.id, fullName: user.fullName, email: user.email, role: user.role },
    // Lets the frontend show the residency-sampling consent screen only
    // once, right after a brand-new signup — not on every subsequent
    // Google sign-in, matching how email signup already behaves.
    isNewUser,
  });
}
