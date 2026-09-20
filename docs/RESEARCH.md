# Scientific foundation for the journalist companion

This is a targeted primary-source review supporting a prototype, not a systematic
review or evidence that Nonius improves journalism. The occupation review motivated
the domain; the following sources inform the interaction design.

## Interviewing evidence

**Spangher et al., ACL 2025, NewsInterview**, [authoritative paper, v2](https://aclanthology.org/2025.acl-long.1580v2.pdf),
studies journalistic interviews directly. It combines a corpus from NPR/CNN with
counterfactual question generation and a simulated interviewing task. Evaluated
LLMs struggled with strategic dialogue and recognizing answered questions. The
authors explicitly limit the realism and reproducibility of their simulation.
Our inference is to keep question coverage and conversational decisions with the
reporter and test redundant prompts. This does not establish that our implementation
improves interviews. We cite the research without redistributing its news transcripts.

**Zhang et al., 2025**, [preprint](https://arxiv.org/abs/2509.12709), studied 17
qualitative interviewers using a researcher-mediated, GPT-4o-assisted setup. Its
discussion recommends controllable scope, typed probes and restrained delivery for
experienced interviewers. Human mediation and simulated interviewees limit transfer
to autonomous software and working journalists. Nonius adopts reporter-selected
spoken delivery and visible evidence. The study motivates testing these choices;
it does not prove their effect.

**Zhang et al., CHIWORK 2026**, [paper](https://arxiv.org/abs/2606.30980), reports
ethical concerns including divided attention, rapport, disclosure and responsibility.
It uses 17 interviewers with the same authors and closely matching setup as the
2025 report. We do not count these as independent replications. Our corresponding
hypotheses are explicit recording controls, no unsolicited speech and reporter
authority over every proposed follow-up. These need practitioner evaluation.

**Requirements Elicitation Follow-Up Question Generation**, 2025,
[paper](https://arxiv.org/abs/2507.02858), distinguishes clarification, probing and
other question types and studies guidance about interviewer mistakes. Its software
requirements domain is adjacent to journalism. We use the typology to define
testable cue categories, not as evidence of newsroom performance. Its section IV-C
prints an inconsistent probability calculation: 2.662 / (1 + 2.662) is about 72.7%,
not the stated 93.5%. We do not reuse that probability or claim its gains for Nonius.

## Professional standard, separate from empirical evidence

The [SPJ Code of Ethics](https://www.spj.org/spj-code-of-ethics/) calls for accuracy,
context, verification and corrections. This is a professional norm, not a controlled
experiment. It motivates original-audio links and separate reporter annotations.
An exact transcript match establishes attribution within the record; it does not
establish truthful source claims, accurate recognition or an identified speaker.

## Competition and scope of contribution

[Trint](https://trint.com/why-trint) already combines live transcription with
media workflows and prompted quote highlighting. [Otter](https://help.otter.ai/hc/en-us/articles/15114041061783-Asking-Otter-AI-Chat-questions)
already answers questions during and after meetings. Therefore neither live
transcription, AI questions nor quote extraction is a new category.

Our candidate contribution is a small, inspectable workflow: model-selected
clarification types, code-checked literal evidence, neutral question templates,
reporter-controlled speech, and portable records of original excerpts and checks.
Whether that combination is more useful or less distracting is an open empirical
question. The benchmark tests bounded behavior, not commercial superiority.

## Design and test map

| Design choice | Basis | Test or remaining evidence |
|---|---|---|
| Speak only when invited | Interviewing studies identify timing and attention concerns | Browser state and speech-event checks; human rapport study still needed |
| Reporter marks coverage and speaker roles | NewsInterview identifies strategic/grounding limitations; role labeling is an explicit attribution constraint | Reject Reporter/Unassigned evidence; include answered-question scenarios; role assignment usability remains untested |
| Typed neutral question templates | Question typology plus explicit engineering constraint | Fixture relevance and unsupported-premise review |
| Exact excerpts before displaying a cue | Professional attribution norm plus enforceable software invariant | Corrupted-span, duplicate-span and unknown-turn tests |
| Original transcript preserved | Context and correction norms | Revision/export tests, separate annotation fields |
| Limited recent context | Latency and cost tradeoff; adjacent-domain study examines context length | Measure omissions on context-dependent cases; no claim ten recent speaker passages is optimal |
| Bounded cloud usage | Resource and cost constraint | Persistent reservations, exhaustion and concurrency tests |
| Synthetic original audio | Available test resources and redistribution control | Narrow STT integration tests; no claims about human speakers or accents |

Ordinary implementation choices do not become scientific findings by receiving a
citation. The evaluation protocol labels each claim and its actual measurement.
