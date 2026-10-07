import { Request, Response } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../config/prisma";
import { getGoogleClient } from "../config/googleAuth";
import { Role } from "../generated/prisma";
import { emailLayout, sendEmail } from "../services/email.service";
import { forgetPasswordChange } from "../middleware/auth.middleware";

function signToken(userId: string, role: Role) {
  return jwt.sign({ userId, role }, process.env.JWT_SECRET as string, {
    expiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  } as jwt.SignOptions);
}

// Government and admin accounts are provisioned separately (see
// admin.controller.ts) — self-service signup only ever creates residents.
// (There used to be a "newcomer" role here too — read/compare only, no
// exclusive capability of its own, since every read path in this app is
// already public with no login required. It added a role picker to the
// signup form for zero actual access-control difference from browsing
// anonymously, so it's gone; anyone wanting to just browse still can,
// without an account at all.)
export async function signup(req: Request, res: Response) {
  const { fullName, email, password } = req.body;

  if (!fullName || !email || !password) {
    return res.status(400).json({ error: "fullName, email, and password are required" });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "An account with this email already exists" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { fullName, email, passwordHash, role: "resident", authProvider: "email" },
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
// config/googleAuth.ts). `isSignup` is only meaningful for a brand-new
// account (self-service signup always creates a resident, see signup()
// above) — the Register page sends true; the Login page omits it, since
// logging in shouldn't silently create an account.
export async function googleAuth(req: Request, res: Response) {
  const { credential, isSignup } = req.body as { credential?: string; isSignup?: boolean };

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
    if (!isSignup) {
      return res.status(404).json({ error: "No account found for this Google email — register first" });
    }
    user = await prisma.user.create({
      data: { fullName, email, role: "resident", authProvider: "google" },
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

// ---------- Password reset ----------

const RESET_LINK_MINUTES = 60;
const MIN_PASSWORD_LENGTH = 8;
const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
const appUrl = () => (process.env.CLIENT_URL ?? "http://localhost:5173").split(",")[0].replace(/\/$/, "");

// POST /api/auth/forgot-password { email }
// Always answers the same way, whether or not an account exists, so the
// form can't be used to find out who has an account.
export async function forgotPassword(req: Request, res: Response) {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const reply = () =>
    res.json({ message: "If an account exists for that email, we've sent a link to reset the password." });
  if (!email || !email.includes("@")) return res.status(400).json({ error: "Enter the email address you signed up with" });

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, fullName: true, email: true, passwordHash: true },
  });
  if (!user) return reply();

  try {
    if (!user.passwordHash) {
      // Signed up with Google: there's no password to reset.
      await sendEmail({
        to: { email: user.email, name: user.fullName },
        subject: "Signing in to GroundTrust",
        text: `Hi ${user.fullName},\n\nSomeone asked to reset the password for this email. Your GroundTrust account uses Google sign-in, so there's no password to reset: choose "Sign in with Google" on the login page.\n\n${appUrl()}/login\n\nIf this wasn't you, you can ignore this email.`,
        html: emailLayout({
          heading: "You sign in with Google",
          paragraphs: [
            `Hi ${user.fullName},`,
            "Someone asked to reset the password for this email. Your GroundTrust account uses Google sign-in, so there's no password to reset.",
          ],
          button: { label: "Go to the login page", url: `${appUrl()}/login` },
          footnote: "If this wasn't you, you can ignore this email.",
        }),
      });
      return reply();
    }

    // One live link at a time: earlier unused links stop working.
    await prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
    const token = crypto.randomBytes(32).toString("base64url");
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_LINK_MINUTES * 60_000) },
    });
    const link = `${appUrl()}/reset-password?token=${token}`;
    await sendEmail({
      to: { email: user.email, name: user.fullName },
      subject: "Reset your GroundTrust password",
      text: `Hi ${user.fullName},\n\nUse this link to choose a new password. It works once, for the next hour:\n\n${link}\n\nIf you didn't ask for this, you can ignore this email; your password won't change.`,
      html: emailLayout({
        heading: "Reset your password",
        paragraphs: [`Hi ${user.fullName},`, "Use the button below to choose a new password. The link works once, for the next hour."],
        button: { label: "Choose a new password", url: link },
        footnote: "If you didn't ask for this, you can ignore this email; your password won't change.",
      }),
    });
  } catch (err) {
    // Logged, but the reply stays the same so it reveals nothing.
    console.error("[auth] forgot-password email failed:", err);
  }
  return reply();
}

// POST /api/auth/reset-password { token, password }
// Sets the new password, uses up the link, and signs the account out
// everywhere (tokens issued before now stop working).
export async function resetPassword(req: Request, res: Response) {
  const { token, password } = req.body as { token?: string; password?: string };
  if (typeof token !== "string" || !token) return res.status(400).json({ error: "This reset link is incomplete" });
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Use at least ${MIN_PASSWORD_LENGTH} characters` });
  }

  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    return res.status(400).json({ error: "This reset link has expired or has already been used. Ask for a new one." });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const now = new Date();
  // Whole seconds: sign-in tokens record their issue time in seconds.
  now.setMilliseconds(0);
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash, passwordChangedAt: now } }),
    prisma.passwordResetToken.updateMany({ where: { userId: record.userId, usedAt: null }, data: { usedAt: now } }),
  ]);
  forgetPasswordChange(record.userId);
  return res.json({ message: "Your password has been changed. You can log in with it now." });
}
