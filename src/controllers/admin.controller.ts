import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import prisma from "../config/prisma";

// Government accounts are never self-service — an authenticated admin
// provisions them directly, per files/HANDOFF.md §2.5. No invite-email flow
// yet; that's a reasonable follow-up once there's a real admin UI.
export async function listGovernmentAccounts(_req: Request, res: Response) {
  const accounts = await prisma.user.findMany({
    where: { role: "government" },
    select: { id: true, fullName: true, email: true, createdAt: true },
  });
  return res.json({ accounts });
}

export async function createGovernmentAccount(req: Request, res: Response) {
  const { fullName, email, password } = req.body;

  if (!fullName || !email || !password) {
    return res.status(400).json({ error: "fullName, email, and password are required" });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "An account with this email already exists" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const account = await prisma.user.create({
    data: { fullName, email, passwordHash, role: "government", authProvider: "email" },
  });

  return res.status(201).json({
    account: { id: account.id, fullName: account.fullName, email: account.email },
  });
}
