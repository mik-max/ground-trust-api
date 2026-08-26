import cors from "cors";
import express from "express";
import adminRoutes from "./routes/admin.routes";
import areaRoutes from "./routes/area.routes";
import authRoutes from "./routes/auth.routes";
import govRoutes from "./routes/gov.routes";
import verificationRoutes from "./routes/verification.routes";

const app = express();

app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use("/api/auth", authRoutes);
app.use("/api/areas", areaRoutes);
app.use("/api/verification", verificationRoutes);
app.use("/api/gov", govRoutes);
app.use("/api/admin", adminRoutes);

export default app;
