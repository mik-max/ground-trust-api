import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../config/prisma";
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
