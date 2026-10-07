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
   | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | From the Cloudinary dashboard (voice recordings) |

   `JWT_SECRET` is generated automatically.
3. Deploy. Migrations are **not** applied automatically: apply them yourself, before
   deploying code that needs them (see "Applying migrations to production" below).
   Check `https://groundtrust-api.onrender.com/health` returns `{"status":"ok"}`.
   If Render assigns a different URL, update both destinations in the frontend's `vercel.json`.
4. Seed demo data once, from your machine, against the production database:

   ```bash
   (set -a; . ./.env; set +a; DATABASE_URL="$PRODUCTION_DATABASE_URL" yarn db:seed)
   (set -a; . ./.env; set +a; DATABASE_URL="$PRODUCTION_DATABASE_URL" yarn nlp:backfill)
   ```

   The second command translates and classifies the seeded comments (it uses
   `ANTHROPIC_API_KEY` from your local `.env`, about 26 short API calls).

## Free-tier behaviour to know about

- **Cold starts.** Render's free service sleeps after 15 minutes idle and takes
  around a minute to wake. Open `/health` shortly before a demo.
- **Weekly recompute job.** It runs inside the server, so it only fires if the
  server is awake at that moment. Scores still recompute on every new review.
- **API docs** are at `/api/docs`.

## Local development and production safety

`backend/.env` has two database addresses:

- `DATABASE_URL` is a **local** PostgreSQL database (`groundtrust_dev`). Everything
  you run locally (`yarn dev`, `yarn db:seed`, `prisma migrate dev`) uses it, so it is
  safe to reset and re-seed. Create it once with `createdb groundtrust_dev`, then
  `yarn db:deploy && yarn db:seed`.
- `PRODUCTION_DATABASE_URL` is the live Neon database. Nothing uses it unless you
  pass it explicitly, as below.

Local voice uploads go to the Cloudinary folder in `CLOUDINARY_AUDIO_FOLDER`
(`groundtrust/dev`), separate from the live site's recordings.

## Applying migrations to production

Migrations only ever add to the schema unless written otherwise; read the new
`migration.sql` files before applying them. Check what is pending, then apply:

```bash
cd backend
(set -a; . ./.env; set +a; DATABASE_URL="$PRODUCTION_DATABASE_URL" yarn prisma migrate status)
(set -a; . ./.env; set +a; DATABASE_URL="$PRODUCTION_DATABASE_URL" yarn prisma migrate deploy)
```

Apply migrations **before** pushing code that depends on them.


## Area photos

Curated area photos are listed in `prisma/data/area-photos.csv`: openly
licensed Wikimedia Commons photos whose recorded location is inside the
area, with the credit and licence each one requires. To add them to
production (uploads to the `groundtrust/areas` Cloudinary folder; already
imported photos are skipped):

```bash
(set -a; . ./.env; set +a; DATABASE_URL="$PRODUCTION_DATABASE_URL" CLOUDINARY_PHOTO_FOLDER="groundtrust/areas" yarn photos:import)
```

Residents' photos go to the same folder from the live API and wait in the
Moderation queue; rejected ones are deleted from Cloudinary. Set
`CLOUDINARY_PHOTO_FOLDER` on Render only if you want a folder other than
`groundtrust/areas`.

## Password reset email (Brevo)

1. Create a free account at brevo.com.
2. Senders, domains & dedicated IPs → Senders → add the address emails
   should come from (for example your Gmail) and click the link Brevo sends.
3. SMTP & API → API keys → generate a key.
4. In Render → groundtrust-api → Environment, set `BREVO_API_KEY`,
   `EMAIL_FROM` (the verified address) and `EMAIL_FROM_NAME` ("GroundTrust").
   `CLIENT_URL` must be the live site (https://ground-trust.vercel.app); reset
   links point there.

Without these, production refuses to send (the request still answers
normally, and the failure is logged).

## Rate limits

`src/middleware/rateLimit.ts` holds them, counted in memory per instance
(they reset on redeploy). Visitors are identified by the first
X-Forwarded-For entry, which Vercel sets; sign-in and reset limits also
count per account or email.
