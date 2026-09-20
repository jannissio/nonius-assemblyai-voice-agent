# Licences and provenance

Original application code, authored documentation and fictional fixture text are
MIT licensed. This does not relicense external services, software or research.

| Runtime package | Version | Licence |
|---|---|---|
| ws | 8.21.3 | [MIT notice](docs/LICENSE-ws.txt) |
| fflate | 0.8.3 | [MIT notice](docs/LICENSE-fflate.txt) |

The lockfile pins these two dependencies. Optional native performance peers are
not required. Install with `npm ci --ignore-scripts`.

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

