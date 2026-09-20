# Licences and provenance

Original application code, authored documentation and fictional fixture text are
MIT licensed. This does not relicense external services, software or research.

| Package | Locked version | Licence |
|---|---|---|
| fflate | 0.8.3 | MIT |
| pg | 8.23.0 | MIT |
| pg-cloudflare | 1.4.0 | MIT |
| pg-connection-string | 2.14.0 | MIT |
| pg-int8 | 1.0.1 | ISC |
| pg-pool | 3.14.0 | MIT |
| pg-protocol | 1.16.0 | MIT |
| pg-types | 2.2.0 | MIT |
| pgpass | 1.0.5 | MIT |
| postgres-array | 2.0.0 | MIT |
| postgres-bytea | 1.0.1 | MIT |
| postgres-date | 1.0.7 | MIT |
| postgres-interval | 1.2.0 | MIT |
| split2 | 4.2.0 | ISC |
| ws | 8.21.3 | MIT |
| xtend | 4.0.2 | MIT |

The three direct dependencies (`ws`, `fflate`, `pg`) are MIT. Transitive packages
also include the permissive ISC licence. Full notices are preserved in
[THIRD_PARTY_LICENSES.txt](docs/THIRD_PARTY_LICENSES.txt). Original Nonius code
remains MIT; third-party code retains its own notices. The lockfile pins the
complete tree. Install with `npm ci --ignore-scripts`.

The Riverton interview and speech-test sentences are fictional, authored for this
project. Their WAV files were synthesized with installed Windows voices. Voice
engines and font binaries are not distributed. Windows System.Speech and browser
speech engines retain their own terms.

`tests/fixtures/usgs-speaker-revision.json` contains observed transcription and
speaker revisions for a short excerpt of [USGS CoreCast episode 108](https://www.usgs.gov/media/audio/us-using-less-water-it-did-35-years-ago),
published 28 October 2009: David Hebert interviewing scientist Bob Hirsch. USGS
identifies the source recording as public domain. Its figures concern 2005 water
use. No endorsement is implied. The source remains public domain; it is not
relicensed as MIT. The original recording is not bundled.

AssemblyAI transcription and LLM Gateway are hosted services subject to their own
terms. No AssemblyAI software or model weights are redistributed. Calling Qwen
through a service does not make its weights part of this MIT source distribution.

Research papers are linked and appraised, not bundled. The NewsInterview corpus
was not used for training and is not redistributed. Node.js, the OS and browser
are runtime platforms with their own licences. Video authoring tools, personal
recordings and development downloads are not included in this repository.

