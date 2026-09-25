# Deploying the backend

The API (Express + Prisma) runs on **Render**, with PostgreSQL on **Neon**. The
frontend lives in a separate repository, is deployed on Vercel, and proxies
`/api` and `/uploads` to this service, so the browser only talks to the Vercel domain.

## 1. Database (Neon)

1. Create a project at neon.tech (region: Frankfurt / `eu-central-1`, next to Render).
2. Copy the connection string (`postgresql://...?sslmode=require`). This is `DATABASE_URL`.

Render's own free PostgreSQL also works, but it is deleted 30 days after creation.

## 2. Web service (Render)

1. In Render: **New → Blueprint**, pick this repository. Render reads `render.yaml`
   and creates the `groundtrust-api` web service.
2. Fill in the environment variables it asks for:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | Neon connection string |
   | `CLIENT_URL` | The frontend's Vercel URL, e.g. `https://groundtrust.vercel.app` |
   | `ANTHROPIC_API_KEY` | Same as local `.env` |
   | `GROQ_API_KEY` | Same as local `.env` |
   | `OPENAI_API_KEY` | Same as local `.env` |
   | `GOOGLE_CLIENT_ID` | Same as local `.env` |

   `JWT_SECRET` is generated automatically.
3. Deploy. The start command applies database migrations, then starts the server.
   Check `https://groundtrust-api.onrender.com/health` returns `{"status":"ok"}`.
   If Render assigns a different URL, update both destinations in the frontend's `vercel.json`.
4. Seed demo data once, from your machine, against the production database:

   ```bash
   DATABASE_URL="<neon connection string>" yarn db:seed
   DATABASE_URL="<neon connection string>" yarn nlp:backfill
   ```

   The second command translates and classifies the seeded comments (it uses
   `ANTHROPIC_API_KEY` from your local `.env`, about 26 short API calls).

## Free-tier behaviour to know about

- **Cold starts.** Render's free service sleeps after 15 minutes idle and takes
  around a minute to wake. Open `/health` shortly before a demo.
- **Voice recordings are not persistent.** Render's free disk is wiped on every
  deploy and restart, so uploaded audio files disappear (their transcripts and
  translations stay in the database).
- **Weekly recompute job.** It runs inside the server, so it only fires if the
  server is awake at that moment. Scores still recompute on every new review.
- **API docs** are at `/api/docs`.
