# Deploying the backend

The two frontends are already Vercel projects. This adds a third one for the
FastAPI backend, so the GCS bucket has a public endpoint to push notifications
at and the dashboards have an API that is not `localhost`.

## How data flows

```
GCS bucket  (READ-ONLY — objectViewer, nothing is ever written here)
   │  a sensor file lands
   │
   ├── object-finalize ──► Pub/Sub topic ──► push subscription
   │                                              │  POST + signed OIDC token
   │                                              ▼
   │                                    POST /api/gcs/pubsub
   │                                       verify token
   │                                       download the object
   │                                       detect_sensor_type + detect_gaps
   │                                                  │
   └── Vercel Cron ──► GET /api/cron/sync ────────────┤
                         reconciliation sweep         │
                                                      ▼
                                            Upstash Redis
                                              summary:<sensor_id>   full
                                              summary_index         hash
                                              consent:*  bumps:*
                                                      │
                  GET /api/gcs/results  ◄─────────────┤  poll, every 2 min
                  GET /api/gcs/results/<id>  ◄────────┘  when a modal opens
```

Analysis results go to **Upstash Redis**, not back into the bucket. GCS is
strictly read-only: the sensor bucket is a regulated dataset, and overwriting an
object there would require `storage.objects.delete`, so the GCS credential needs
nothing beyond `objectViewer`.

## What is Vercel-specific

Two files: `api/index.py` and `vercel.json`. Everything else is plain FastAPI.
Moving to Cloud Run later means writing a Dockerfile and deleting those two —
the application code does not change, and neither does the stored data.

---

## 1. Service account

In the GCP project that owns the bucket:

```bash
PROJECT=<your-project-id>
BUCKET=<your-bucket-name>

# The identity the backend reads and writes as.
gcloud iam service-accounts create ami-backend \
  --display-name="Ambient Intelligence backend" --project="$PROJECT"

SA="ami-backend@${PROJECT}.iam.gserviceaccount.com"

# objectViewer is enough: state lives in Redis, so nothing is ever written to
# this bucket. Scope it to the bucket, never to the whole project.
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member="serviceAccount:${SA}" --role="roles/storage.objectViewer"

gcloud iam service-accounts keys create key.json \
  --iam-account="$SA" --project="$PROJECT"
```

`key.json` is a long-lived credential. Do not commit it — `.gitignore` covers
`*.json` only incidentally, so keep it outside the repository. Encode it for
Vercel, which has no filesystem to point `GOOGLE_APPLICATION_CREDENTIALS` at:

```bash
base64 -i key.json | tr -d '\n' | pbcopy
```

## 2. Create the Vercel project

From the repository root (not `frontend/`):

```bash
vercel link          # create a NEW project, e.g. ambient-api
vercel env add GCS_BUCKET_NAME production
vercel env add GCS_PROJECT_ID production
vercel env add GCS_CREDENTIALS_B64 production      # paste the base64 blob

# Provision Redis. This injects KV_REST_API_URL / KV_REST_API_TOKEN into the
# project automatically; the app reads those or the UPSTASH_* equivalents.
vercel integration add upstash
vercel env add CRON_SECRET production              # openssl rand -hex 32

# The participant roster (PINs, floor plans, sensor lists). Deliberately not in
# the repository — it holds login PINs and the repo is public. Generate with:
#   base64 -i participant_config.json | tr -d '\n'
vercel env add PARTICIPANT_CONFIG_JSON production
vercel env add RESIDENT_REQUESTS_SHEET_URL production
vercel --prod
```

Then confirm the connection before wiring anything else up:

```bash
curl https://<your-api>.vercel.app/api/gcs/status
```

Check three things in the response:

- `reachable: true` — the GCS credential works and the bucket exists.
- `sensors_last_24h` — a file count per Geoscope. Zero means nothing is arriving.
- `state.reachable: true` — Redis is connected. If `state.backend` says
  `memory`, the Upstash variables did not reach the deployment and every result
  will be lost between requests.

If GCS is unreachable, the `error` field says why — a wrong bucket name and an
empty bucket are no longer indistinguishable.

## 3. Point the frontends at it

In each frontend's Vercel project settings, set:

```
VITE_API_URL=https://<your-api>.vercel.app
```

Vite inlines env vars at build time, so both frontends need a redeploy — an
environment variable change alone will not take effect.

Then lock down CORS, which currently defaults to `*`:

```bash
vercel env add ALLOWED_ORIGINS production
# https://researcherview.vercel.app,https://frontend-participant-ambient-intell.vercel.app
```

## 4. Pub/Sub push

```bash
REGION=us-central1
API=https://<your-api>.vercel.app/api/gcs/pubsub

gcloud pubsub topics create ami-sensor-uploads --project="$PROJECT"

# Notify only on new objects. OBJECT_FINALIZE also fires on overwrites, which
# is what you want — a re-uploaded file should be re-analysed.
gcloud storage buckets notifications create "gs://${BUCKET}" \
  --topic=ami-sensor-uploads --event-types=OBJECT_FINALIZE \
  --payload-format=json

# A separate identity for Pub/Sub to sign push tokens as.
gcloud iam service-accounts create pubsub-push \
  --display-name="Pub/Sub push" --project="$PROJECT"
PUSH_SA="pubsub-push@${PROJECT}.iam.gserviceaccount.com"

gcloud pubsub subscriptions create ami-sensor-uploads-push \
  --topic=ami-sensor-uploads \
  --push-endpoint="$API" \
  --push-auth-service-account="$PUSH_SA" \
  --push-auth-token-audience="$API" \
  --project="$PROJECT"
```

Then tell the backend what to accept:

```bash
vercel env add PUBSUB_AUDIENCE production           # the $API URL above
vercel env add PUBSUB_SERVICE_ACCOUNT production    # the $PUSH_SA address
vercel --prod
```

The handler still skips anything under `_summaries/` and `_state/`. Nothing
writes there now that state lives in Redis, but the guard costs nothing and
matters if GCS is ever used as the state store: writing a summary would fire a
notification for that summary, which would be processed, which would write a
summary — the bucket notifying itself forever.

## 5. Geoscope ingest

This bucket holds JSON, not CSV: `<gateway>/data/<date>/<SENSOR>/<ts>.json`,
one file every ~2 minutes, each ~115 records of 500 samples (one second at
500 Hz). A file is therefore not a dataset — analysing them one at a time gives
each sensor a two-minute report that the next file overwrites. Use the grouped
endpoint, which concatenates a rolling window:

```bash
curl -X POST "https://<your-api>.vercel.app/api/gcs/sync-geoscope?window_hours=2"
```

Do **not** run a full-bucket sweep. There are ~68,000 objects and 19 GB here;
`window_hours` is the cost control, and `max_files_per_sensor` caps it further.

`upload_lag_minutes` (default 20) exists because the gateway uploads several
minutes after recording. Files are selected by upload time but samples are
filtered by recording time, so without that allowance the window is misaligned
and a perfectly healthy sensor reports ~80% completeness.

---

## Testing the webhook locally

Pub/Sub cannot reach `localhost`, so during local development use the sync
endpoint instead:

```bash
python3 -m uvicorn api:app --port 8000
curl -X POST "http://localhost:8000/api/gcs/sync?full=true"
```

To exercise the push handler itself, expose the local server:

```bash
cloudflared tunnel --url http://localhost:8000
# point a push subscription at the temporary https URL it prints
```

There is no real OIDC token when replaying a message by hand, so verification
has to be turned off for that case only:

```bash
PUBSUB_VERIFY=0 python3 -m uvicorn api:app --port 8000
```

Never set that in a deployed environment — it makes the endpoint an open write.

---

## Cron frequency

`vercel.json` schedules `/api/cron/sync` daily. **Hobby plans allow at most two
cron jobs, once per day**, so a shorter interval silently will not run. Pub/Sub
is the freshness mechanism; the cron is only a safety net for missed
deliveries. If you need frequent polling instead of push — a bucket you cannot
attach notifications to, say — that needs a Pro plan, or an external scheduler
hitting `/api/cron/sync`.

---

## Moving to Cloud Run later

The application is already host-neutral. The move is:

1. Write a Dockerfile running `uvicorn api:app --host 0.0.0.0 --port $PORT`.
2. Deploy with the `ami-backend` service account **attached** — then drop
   `GCS_CREDENTIALS_B64` entirely, because Application Default Credentials
   resolve to the attached identity and no key material is stored anywhere.
3. Repoint the push subscription and `VITE_API_URL` at the new URL.
4. Keep the same Upstash credentials and the state carries over untouched.

Worth knowing: on Cloud Run the external store stops being *necessary*. One
long-lived process can hold results in memory and refresh on a timer, which is
what `state.py`'s memory backend already does. Redis is required by Vercel's
execution model, not by the application. Keeping it is still the better choice
if more than one instance ever runs, since two instances cannot share RAM.

Delete `api/index.py` and `vercel.json` when the Vercel project is retired.

---

## Participant roster and PINs

`participant_config.json` is **not** committed. It holds participant login PINs,
the GitHub repository is public, and a PIN in git history stays readable after
the file is deleted. The deployed API gets the roster from
`PARTICIPANT_CONFIG_JSON`; locally the file is used, so nothing changes for
development. `.vercelignore` also excludes it, so a CLI deploy cannot
accidentally bundle it — a missing variable then fails loudly at boot rather
than silently shipping PINs inside the function.

Untracking it does not unpublish the PINs that are already in history. Either
make the repository private, or rotate the PINs, or both.

## Open items

- **Participant PINs become internet-reachable.** `/api/participant/login`
  accepts a 4-digit PIN with no rate limiting, so an attacker can walk all
  10,000 in minutes. On localhost that was unreachable; deployed it is not.
  Worth adding rate limiting or longer PINs before real participants use it.
- **`/api/gcs/sync` and `/api/gcs/reindex` are unauthenticated.** Only
  `/api/cron/sync` checks `CRON_SECRET`. Anyone who finds the URL can trigger a
  full bucket rescan.
- **Sync speed.** Downloads are sequential: ~48 files (30 min of data across
  three sensors) took ~30 s. A 2-hour window is ~200 files, which is close
  enough to the 300 s function ceiling to be worth parallelising before
  increasing the window much further.

- **Geoscope sensors are missing from the frontend config.** `SENSOR_DEFAULTS`
  in `frontend/src/config/sensorConfig.js` has a `vibration` entry but nothing
  for `vibration_103` / `vibration_105` / `vibration_140`, so they render with
  no floor-plan position or label until entries are added.

- **`live` is always false for Geoscope.** `check_sensor_live` compares against
  `SENSOR_CONFIG["vibration"]["gap_threshold_sec"]`, which is 5 seconds — the
  right tolerance for 500 Hz sample jitter, but the gateway uploads in ~7 minute
  batches, so a perfectly healthy sensor always looks stale. This needs its own
  liveness threshold in `SENSOR_CONFIG`, separate from the sample-gap one.
