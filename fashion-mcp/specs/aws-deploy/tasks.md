# Tasks: Deploy fashion-mcp to AWS with production-ready infra, tests, and docs

## Overview

Total tasks: TBD

POC-first workflow:
1. Make it work (POC)
2. Refactor
3. Tests
4. Quality gates
5. (Optional) PR/release lifecycle

## Task format

For each task, include:

- **Do**: exact steps
- **Files**: paths to create/modify
- **Done when**: explicit success criteria
- **Verify**: command(s) or manual checks

## Phase 1: Make it work (POC)

- [ ] 1.1 {{task name}}
  - **Do**: {{steps}}
  - **Files**: {{paths}}
  - **Done when**: {{criteria}}
  - **Verify**: {{command/manual}}
  - _Reqs: FR-1, AC-1.1_

- [ ] 1.2 {{task name}}
  - **Do**: {{steps}}
  - **Files**: {{paths}}
  - **Done when**: {{criteria}}
  - **Verify**: {{command/manual}}

- [ ] 1.3 Quality checkpoint
  - **Do**: run local checks to catch regressions early
  - **Verify**: {{typecheck}} + {{lint}} + {{tests/build}}
  - **Done when**: all checks pass

- [ ] 1.4 POC checkpoint (end-to-end)
  - **Do**: validate the feature works in a realistic environment
  - **Verify**: {{manual steps}}
  - **Done when**: the core flow can be demonstrated

## Phase 2: Refactor

- [ ] 2.1 Extract and align with project patterns
  - **Do**: {{refactor steps}}
  - **Files**: {{paths}}
  - **Done when**: code is idiomatic for this repo
  - **Verify**: {{typecheck/build}}

- [ ] 2.2 Quality checkpoint
  - **Verify**: {{typecheck}} + {{lint}} + {{tests/build}}

## Phase 3: Tests

- [ ] 3.1 Unit tests
  - **Do**: {{what to unit test}}
  - **Verify**: {{unit test command}}
  - _Reqs: AC-1.x_

- [ ] 3.2 Integration tests (if applicable)
  - **Do**: {{what to integration test}}
  - **Verify**: {{integration test command}}

## Phase 4: Quality gates

- [ ] 4.1 Lint/format/types
  - **Verify**: {{commands}}

- [ ] 4.2 Full test suite / build
  - **Verify**: {{commands}}

## Phase 5: PR / release (optional)

- [ ] 5.1 Update docs/changelog (if needed)
- [ ] 5.2 Monitor CI and resolve failures

