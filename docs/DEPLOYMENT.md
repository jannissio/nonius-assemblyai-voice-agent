# Hosting Nonius

The application needs a Node.js 22+ server and WebSocket support for live speech.
GitHub Pages is a static host and cannot run this backend. Replit is one of the
platforms named in the lablab submission rulebook.

## Public interactive sample

1. Import this source repository or a clean source ZIP into Replit.
2. Install with `npm ci --ignore-scripts` and run `npm run host`.
3. The `.replit` file maps port 4317 and supplies the build/run commands.
4. Publish a web server deployment and open its HTTPS URL directly. The app blocks
   third-party framing, so use a separate browser tab if the editor preview is blank.
5. Confirm the sample loads, audio replays and a notebook ZIP downloads.

The hosted launcher defaults to **keyless sample mode**. It ignores provider
credentials even if they exist in the host environment. Visitors can explore the
fictional transcript, saved suggestions and evidence notebook. They cannot
transcribe new audio or obtain live model suggestions in this mode. The sample is
clearly labeled and is not a substitute for verifying the live integration.

Replit injects deployment domains through `REPLIT_DOMAINS` and its preview domain
through `REPLIT_DEV_DOMAIN`. These become explicit allowed hosts. If a domain is
not supplied automatically, set `NONIUS_ALLOWED_HOSTS` to its exact hostname.
Never derive the allowlist from an incoming HTTP request.

## Protected live hosting

Configure these **server-side secrets/settings** only after the public sample works:

| Setting | Meaning |
|---|---|
| `NONIUS_HOSTED_MODE=live` | Explicitly enable live mode |
| `ASSEMBLYAI_API_KEY` | Private provider credential; never put it in source or client settings |
| `NONIUS_DEMO_PASSWORD` | Random password of at least 16 characters; username is `nonius` |
| `NONIUS_ALLOWED_HOSTS` | Exact HTTPS deployment hostname, without scheme or port |
| `NONIUS_BUDGET_PATH` | File on a genuinely durable, writable volume |
| `NONIUS_DURABLE_BUDGET_CONFIRMED=true` | Operator confirms durable storage and one instance |
| `NONIUS_BUDGET_USD`, `NONIUS_MAX_AUDIO_SECONDS`, `NONIUS_MAX_LLM_CALLS` | Conservative reservation ceilings |
| `NONIUS_MAX_SESSION_SECONDS` | Maximum audio session duration |
| `NONIUS_LLM_COOLDOWN_SECONDS` | Minimum spacing between analysis reservations |

The confirmation setting does not provision or verify storage. Replit recommends
against relying on a published app's filesystem for persistence. Do not enable live
mode on ephemeral or independently scaled instances with this file-based ledger;
use persistent single-instance hosting or implement transactional shared accounting
first. A public sample requires neither a key nor a durable paid-use ledger.

Use HTTPS for Basic authentication. Keep the demo password separate from the API
key and share it privately with intended reviewers. Browser speech synthesis is
used on Linux; microphone access requires a secure context and user permission.
Check a short, consented audio sample before relying on the hosted live path.

No paid hosting upgrade, public live credential or hosting URL is implied by the
presence of `.replit`. Confirm the actual service limits and URL after deployment.

Sources: [Replit Secrets](https://docs.replit.com/core-concepts/project-editor/app-setup/secrets),
[publishing and persistence](https://docs.replit.com/learn/projects-and-artifacts/replit-deployments),
[lablab rules](https://lablab.ai/hackathon-rules),
[GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).

