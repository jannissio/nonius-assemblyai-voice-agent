> Publication copy: personal operational context and account limits were removed.
> The original protocol hash remains in `eval/freeze-v2.json`; see EVALUATION.md.

# Evaluation protocol, version 1

Written 2026-09-19 before executing the text benchmark or making paid API calls.
The sample interview is development material and is excluded from benchmark results.
This is a timestamped local protocol, not an external preregistration.

## Claims and evaluation objects

1. **Evidence integrity:** accepted cues contain literal, uniquely located excerpts
   and a focus copied from their supporting evidence. Reconciliation requires two
   distinct spans. Test corrupted excerpts, invented turn IDs, ambiguous repeated
   text, unsupported focus, malformed structures and prompt-injection text.
2. **Task detection:** on an authored set of bounded interview situations, report
   whether the model selects the expected clarification type, whether it adds an
   unexpected type, and whether validation rejects its output. Include negative
   cases where no clarification is needed. This label-based measure is not a
   journalist's rating of question quality or a measure of improved reporting.
3. **Speech fidelity:** report recognition of predeclared critical slots on eight
   synthetic test utterances, keeping the two development utterances separate.
   Show every transcript and mismatch. The synthesizer is one installed English
   voice; changing its rate does not create independent speakers.
4. **Integration:** verify actual AssemblyAI WebSocket transcription, browser
   interaction, TTS requests, excerpt playback and bundle checksums. Distinguish
   automation evidence from a human listening or confirming a quotation.

## Frozen artifacts and procedures

- `eval/cases.json` contains the authored text cases and expected cue types.
- `fixtures/speech-cases.json` contains source texts and allowed slot spellings.
- `lib/agent.mjs` contains the model prompt, schema and version.
- `eval/freeze-v2.json` preserves the file hashes recorded before evaluation.
- Default model: `claude-haiku-4-5-20251001` through AssemblyAI LLM Gateway,
  temperature 0, maximum 1,200 output tokens, no automatic retries/fallback.
- Default speech model: `universal-3-5-pro`, 16 kHz mono PCM16, no paid add-ons.
- Run the text cases once in listed order, with at most two requests concurrently.
- Preserve raw structured responses and validated outputs, including errors.
- Report counts and denominators. This small, authored set does not justify a
  population accuracy estimate, significance test or ranking against journalists.
- Any later prompt/case change gets a dated entry and a new result file. Do not
  overwrite the first run or call a tuned rerun a held-out result.

## Baselines and ablations

The deterministic local rules run on the same text cases as a transparent baseline.
The unvalidated model proposals and validated model proposals share one response,
so differences isolate rejection by the evidence check, not model stochasticity.
Mutation tests inject unsupported evidence and verify its rejection. They test
software invariants and are reported separately from naturally occurring errors.

## Human validation still required

A practitioner pilot should compare manual notes plus transcription with Nonius on
matched interviews, counterbalance task order and obtain informed consent. Collect
missed clarification opportunities, irrelevant suggestions, completion time,
rapport/distraction ratings and qualitative feedback. A reviewer independent of
implementation should assess question neutrality and relevance. Human participant evaluation has not been conducted.

## Resource controls

Conservative local reservations bounded API usage. These are not an account
balance query or a provider billing guarantee.

## Amendment A — 2026-09-19, before any live text benchmark

Development calls to Haiku 4.5 and Gemini returned HTTP 400; the full response
identified account model-access restrictions. Qwen 3.5 4B Fast succeeded. The
live benchmark therefore uses `qwen3.5-4b-32k-fast`, temperature 0, 1,200 output
tokens. The semantic prompt and cases are unchanged. This model does not support
`response_format`, so the same JSON schema is appended to the system prompt;
JSON parsing and local validation remain mandatory. No repair or retry is added.
The first rules result and original freeze remain preserved. New results use an
explicit amended label. This is an availability decision, not a quality ranking.
The models endpoint lists USD 0.10/M input and 0.50/M output; the budget ledger
deliberately retains the higher Haiku reservation allowance. A cross-process lock
and fresh reads prevent the CLI evaluator and server from losing reservations.

Development-only Qwen responses used Markdown fences and paraphrased a focus.
Before the live benchmark, v2 adds one worked example using a development route
comparison. It allows stripping a single complete JSON Markdown wrapper, but no
content repair. Excerpt checks now also reject any evidence not explicitly labeled
Source. Live speech starts Unassigned; the reporter must assign roles. These
changes precede the first live benchmark. The already inspected rules baseline
and authored test cases mean this is an engineering benchmark, not a blind test.
