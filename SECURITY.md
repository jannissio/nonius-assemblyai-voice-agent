# Security and privacy

Provider credentials are read by the Node server. The browser receives a boolean
indicating live availability, model names and quota status, never the provider
key. Static routes are allowlisted and do not serve `.env`, runtime files or
server configuration. Credentials and upstream error bodies are not logged.

The application checks HTTP/WebSocket hosts and browser origins, bounds payloads,
audio duration and concurrent operations, and applies local rate and budget
controls. A live server bound beyond loopback requires a demo password of at
least 16 characters. This shared password is a prototype access control, not
individual user accounts or a production security audit.

For a public deployment:

1. Use HTTPS and the host's secret manager. Keep `.env` out of Git and uploads.
2. Allow only the exact deployment hostname. Do not use a wildcard.
3. Keep the live demo password private and separate from the AssemblyAI key.
4. Put the quota ledger on durable storage and use a single app instance. An
   ephemeral filesystem or independently scaled copies can reset or multiply
   the allowance. The app's reservation is not a provider billing guarantee.
5. Keep recording consent and cloud processing clear. Avoid confidential source
   material in this prototype. Exported notebooks are unencrypted.

`npm run demo` and the default hosted sample mode ignore provider keys entirely.
Use that mode for unrestricted public exploration without paid API access.

Do not post credentials or private interview material in public issue reports.
If a credential is exposed, revoke it through its provider and replace it in
server secrets; removing it from the latest Git commit alone is insufficient.

