import dotenv from "dotenv";
dotenv.config();

import app from "./src/app";
import { startScheduledJobs } from "./src/jobs/recompute.job";
import { startActivityFlushing } from "./src/services/activity.service";

const port = process.env.PORT ?? 8000;

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  startScheduledJobs();
  startActivityFlushing();
});
