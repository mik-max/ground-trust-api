import cors from "cors";
import express from "express";
import adminRoutes from "./routes/admin.routes";
import areaRoutes from "./routes/area.routes";
import authRoutes from "./routes/auth.routes";
import govRoutes from "./routes/gov.routes";
import uploadRoutes from "./routes/upload.routes";
import verificationRoutes from "./routes/verification.routes";
import { UPLOADS_DIR } from "./config/upload";

const app = express();

app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
app.use(express.json());
app.use("/uploads", express.static(UPLOADS_DIR));

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use("/api/auth", authRoutes);
app.use("/api/areas", areaRoutes);
app.use("/api/verification", verificationRoutes);
app.use("/api/gov", govRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/uploads", uploadRoutes);

// Catches multer errors (oversized/wrong-mimetype uploads) and anything
// else passed to next(err), so clients get JSON instead of Express's
// default HTML error page.
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(400).json({ error: err.message || "Request failed" });
});

export default app;
