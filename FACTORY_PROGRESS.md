# Creator OS Factory Mode — Progress Tracker

## Current status

Factory Mode is now implemented as an MVP orchestration layer on top of the existing automation backend.

The product has moved from "module-first" toward "factory-first", but it is **not yet a complete production factory**.

---

## What is already done

### Backend

- [x] canonical factory launch endpoint: `POST /api/factory/run`
- [x] job read endpoint: `GET /api/factory/jobs/:jobId`
- [x] job list endpoint: `GET /api/factory/jobs`
- [x] retry endpoint: `POST /api/factory/jobs/:jobId/retry`
- [x] publish package export: `GET /api/factory/jobs/:jobId/package.txt`
- [x] runtime job persistence in `runtime/jobs`
- [x] job progress, step, status, and log updates during execution
- [x] reuse of the existing script/voice/clips/render/publish pipeline

### Frontend

- [x] Factory Mode as the default main screen
- [x] simple launch form
- [x] advanced settings accordion
- [x] job progress block
- [x] recent jobs list
- [x] retry from UI
- [x] result package block
- [x] copy buttons for manual publishing
- [x] package download button
- [x] mobile mode toggle
- [x] readiness/status chips for required services

### Product direction

- [x] Factory-first technical specification added
- [x] one-click flow concept documented
- [x] publish-ready manual package defined as current MVP target

---

## What still needs to be done for MVP completeness

### Product / UX

- [ ] make the factory screen visually cleaner and more compact
- [ ] improve mobile layout beyond a simple toggle
- [ ] add clearer empty states / error states
- [ ] show richer final package metadata (title, caption quality, source clips, scene summary)

### Backend / orchestration

- [ ] normalize factory step count and step naming
- [~] stronger validation added for payload shape/platform count, but more policy checks are still needed
- [ ] add a dedicated signal-generation stage before script generation
- [~] retry metadata added (`retryOf`, `retryDepth`), but full retry policy is not finished
- [~] backend cancel endpoint added, but UI/step-interrupt semantics are still basic

### Persistence / data

- [~] optional Supabase sync/fallback added, but full DB-backed job model is not finished
- [ ] keep job history across deployments more reliably
- [ ] save publish-ready package metadata in a more structured schema

### Publishing workflow

- [ ] make output package richer for manual publishing
- [ ] add title/hashtag generation guarantees
- [ ] add downloadable ZIP/package assets if needed
- [ ] optionally add draft export for manual publish workflows

### Reliability

- [x] add automated tests for backend endpoints
- [x] add integration tests for job flow
- [ ] handle partial failures more gracefully
- [ ] improve logs for debugging Render issues

---

## External blockers

The factory can run in fallback/demo mode without all providers, but full-value execution still depends on:

- `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`
- `ELEVENLABS_API_KEY`
- `PEXELS_API_KEY`
- FFmpeg availability on the server
- publishing credentials for later phases

---

## Current maturity assessment

### Implemented now

```text
MVP factory shell + job orchestration + manual publish package
```

### Not done yet

```text
production-grade automation factory
```

---

## Recommended next implementation order

### Next 1

- strengthen payload validation
- improve final result package structure
- refine mobile experience

### Next 2

- add real signal-generation stage
- add Supabase-backed jobs
- add automated tests

### Next 3

- improve manual publish workflow
- add job history filters/search
- add production observability
