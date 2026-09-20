# Evaluation and reproducibility

These are authored engineering checks, not evidence that Nonius improves journalism.
The cases and labels were created during implementation, without blind independent
adjudication. No journalist participants or human listening ratings are claimed.

## Current application

The live selector is `lib/followups.mjs` (`interview-followups-v3`). It considers
prepared questions, their coverage and prior suggestions. `lib/analysis-passages.mjs`
assembles the recent speaker passages used for analysis. Tests exercise grouping,
speaker revisions and literal evidence that spans transcription chunks.

Three known-input v3 development checks produced a weak date question, a plausible
example question and no cue for one answered control. These inputs were known
during design. Three later USGS configurations each produced a card, including
the original-fragment baseline. This does not establish improved usefulness or
general reliability. Stored summaries are in `eval/results/`.

## Historical v2 benchmark

The frozen adapter remains in `lib/agent.mjs`. It is preserved for provenance;
the live app calls v3. The following results must not be presented as v3 accuracy.

| Measure | Observed result |
|---|---|
| Authored text cases | 34, including 24 positive and 10 quiet-negative cases |
| Local rules baseline | 14/34 exact category matches |
| Initial live Qwen run | 15/34 exact matches; 18 HTTP 429 errors |
| Operational recovery | Only those 18 rate failures retried once; zero provider errors |
| Combined two-pass result | 29/34 exact matches |
| Expected category present | 21/24 positive cases |
| Correctly quiet | 8/10 negative cases |
| Successful request latency | Median 595 ms, range 497–682 ms, n=34; excludes transcription, UI, speech and cooldown |
| Speech critical slots | 19/19 across eight synthetic clips, 45.11 seconds |

Every remaining category mismatch is retained:

| Case | Expected | Returned |
|---|---|---|
| T16 | next_step | none |
| T17 | next_step | none |
| T23 | correction | date |
| N03 | none | correction |
| A02 | none | comparison |

The text protocol was frozen locally, then amended before the live benchmark to
use the accessible Qwen model and tolerate a complete JSON Markdown wrapper.
This was an availability decision, not a model-quality comparison. The single
recovery run kept the prompt, cases and validator unchanged; no quality failure
was retried. The protocol was not externally preregistered.

Speech used one installed English synthetic voice. Slot presence checks allowed
spellings with token boundaries. It is not word-error rate and does not establish
performance across accents, noise, speakers or microphone hardware.

Longer fictional sample runs also produced redundant cues, focus on a superseded
number and a rejected malformed response. The saved sample retains these limitations.
The malformed run did not retain its raw response; that absence remains documented
in its result file. A literal match cannot prove relevance or truth.

## Reproduce without provider calls

```sh
npm ci --ignore-scripts
npm test
npm run reproduce
```

The reproduction command recalculates category matches from the preserved outputs,
checks recovery was limited to initial HTTP 429 failures, recalculates speech
slots from transcripts, checks source-audio hashes and verifies the frozen code
and case hashes. It does not promise that a future provider call returns the same
response. The separate 10,000 altered-span test varies a single quotation fixture.

## Publication and privacy

`eval/freeze-v2.json` preserves the original pre-run hash record. The four code
and case files in that record are unchanged. The public copy of
`docs/EVALUATION_PROTOCOL.md` removes personal operational context and account
limits and replaces a reference to an internal freeze-writing utility with its
saved manifest. Its original and published hashes are recorded separately in
`eval/publication.json`; it is not represented as byte-identical to the original.

Stored results retain measured text, proposed/accepted cues, errors, timings,
labels and token counts. Account budget snapshots, rate headers, private working
file pointers and provider session identifiers were removed. No observations or
failed outcomes were removed to improve a reported score. Development summaries
refer to observations outside the frozen benchmark; raw third-party development
audio is not redistributed here.

The [practitioner pilot](PRACTITIONER_PILOT.md) is proposed future work.

