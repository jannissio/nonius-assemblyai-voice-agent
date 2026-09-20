# Hosting Nonius

Nonius needs Node.js 22+ and WebSocket support for live speech. Replit is named
in the lablab rulebook. GitHub Pages cannot run the backend.

## Start with the credit-free sample

Import the source repository or a clean source ZIP. Install with
`npm ci --ignore-scripts` and run `npm run host`. The supplied `.replit` file sets
the build/run commands and port 4317. Publish a web-server deployment and verify
its HTTPS URL directly in a browser. The app blocks third-party framing.

The hosted launcher defaults to sample mode and ignores provider credentials.
Visitors can explore the fictional transcript, saved suggestions, audio and
notebook. Transcribing new audio requires explicit live configuration.

## Enable live access

Use Replit's private Secrets for credentials and Configurations for other settings:

| Setting | Meaning |
|---|---|
| `NONIUS_HOSTED_MODE=live` | Enable the live backend |
| `ASSEMBLYAI_API_KEY` | Private provider credential |
| `DATABASE_URL` | Private PostgreSQL connection supplied by the host |
| `NONIUS_PUBLIC_LIVE=true` | Opt into public live access with persistent quotas |
| `NONIUS_DEMO_PASSWORD` | Optional restricted-access alternative; at least 16 characters, username `nonius` |
| `NONIUS_ALLOWED_HOSTS` | Exact deployment hostname, without scheme or port |
| `NONIUS_DAILY_BUDGET_USD` | Conservative daily reservation ceiling in US dollars |
| `NONIUS_BUDGET_USD` | Cumulative reservation ceiling in US dollars |
| `NONIUS_BUDGET_TIMEZONE` | Daily reset timezone; default `Europe/Berlin` |
| `NONIUS_MAX_AUDIO_SECONDS`, `NONIUS_MAX_LLM_CALLS` | Additional cumulative resource ceilings |
| `NONIUS_MAX_SESSION_SECONDS` | One session's maximum duration, default 180 seconds |
| `NONIUS_LLM_COOLDOWN_SECONDS` | Minimum spacing between analysis reservations |

The host's `REPLIT_DOMAINS` and `REPLIT_DEV_DOMAIN` also supply exact allowed
hostnames. Request headers never extend the allowlist. Keys never belong in
client code, a Git repository, URLs or build arguments.

The hosted launcher creates the `nonius_usage_budget` table and a single stable
ledger row. It stores only counters, reservation timestamps and amounts, not
interview content, provider keys or visitor IPs. A transaction locks the row,
checks daily and cumulative limits, records the reservation and commits before
any paid request. An unavailable database blocks paid use. Restarting an app
does not create a fresh allowance; never recreate the production database or
change the ledger identifier to work around a cap.

Development and production databases are separate on Replit. Prepare the table
in development, create the production database through Publishing, and confirm
the live configuration refers to the production database after publication.
Do not overwrite production data with development data on later republishes.

Daily limits reset at local midnight in the configured IANA timezone. Total
reservations never reset automatically. Audio reserves the entire permitted
session; LLM calls use conservative input-byte and maximum-output allowances.
Unused reservations are not refunded. These are application controls, not an
AssemblyAI account balance or billing guarantee. If a budget is expressed in
another currency, choose conservative dollar ceilings and document the conversion.

Before enabling provider access, run the offline suite and the separate database
probe: `node scripts/verify-durable-budget.mjs`. It uses a unique test ledger,
checks concurrent reservations and persistence, then removes only that test row.
It makes no AssemblyAI calls and never prints the connection string. Run it in
the hosting environment where `DATABASE_URL` is provided privately.

Verify live WAV transcription, follow-up evidence and export over the published
HTTPS URL. Linux uses browser speech synthesis; microphone capture requires
browser permission. Visitors share the public allowance, so the labeled sample
remains available when live credit is exhausted.

Sources: [Replit Secrets](https://docs.replit.com/core-concepts/project-editor/app-setup/secrets),
[database](https://docs.replit.com/features/data-and-storage/sql-database),
[publishing](https://docs.replit.com/learn/projects-and-artifacts/replit-deployments),
[lablab rules](https://lablab.ai/hackathon-rules).
