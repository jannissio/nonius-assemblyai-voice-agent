# Limitations

- This is a prototype, not a validated newsroom or confidential-source platform.
  No practitioner outcome study has been conducted.
- Recognition and speaker attribution can be wrong. Names apply within one
  interview; the app does not identify a person's voice across sessions. Review
  final speaker changes and check quotations against the original audio.
- Follow-up context is bounded to recent speaker passages plus the brief,
  prepared-question coverage and recent suggestion history. Earlier answers can
  fall outside that context. Suggestions can be redundant, weak or absent.
- Exact-excerpt validation checks support inside the transcript, not the truth
  of a claim, completeness of transcription or correctness of its speaker label.
- Audio-check boxes are reporter self-attestations. A checksum establishes file
  consistency relative to its manifest, not source authenticity.
- The keyless sample is fictional, uses synthetic voices and replays saved
  responses. It is not a live API test. Sample speaker labels are scripted.
- Live sessions and calls are bounded. Provider errors, rate limits and credit
  exhaustion can interrupt transcription or suggestions.
- Windows speech uses an installed OS voice. Browser speech varies by device;
  some browser voices may use a network service. Headphones reduce feedback.
- Interview content is held in browser memory and exports are unencrypted.
  Closing or refreshing the page loses unsaved work. This is not a multi-user
  collaboration or durable archival system.
- The local budget file is not a provider invoice. An ephemeral hosting filesystem
  can reset a local file ledger. The hosted launcher uses PostgreSQL transactions
  for daily and cumulative limits and stops paid calls if accounting fails.
  Public visitors share the allowance and may exhaust it. See DEPLOYMENT.md.

