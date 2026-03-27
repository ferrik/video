# Creator OS vNext — Factory-first Technical Spec

## 1. Product goal
Transform Creator OS from a multi-module AI dashboard into a **one-click content factory**.

Primary user promise:

```text
one button -> one full production cycle -> ready for manual publishing
```

The system should take a compact input payload and automatically run:

```text
topic/signal
-> script
-> voice
-> stock clips
-> render
-> publish package
-> save outputs
-> ready for publishing
```

Publishing is **manual for MVP**.

---

## 2. Product principles
1. **Factory-first**: the main screen is the factory launcher, not the module grid.
2. **Hidden complexity**: advanced options stay collapsed by default.
3. **Job-based UX**: the user sees progress, status, and result, not internal tool handoffs.
4. **Manual publishing first**: finish the pipeline up to a publish-ready package before building autoposting.
5. **Mobile-lite**: mobile mode is for run/status/result, not for the full dashboard.

---

## 3. Primary user flow

The user lands on the **Factory Mode** screen.

### 1. Launch

Input fields (all required for simple mode):
- **Topic**: e.g. "cockroach control London"
- **Product**: e.g. "gel bait"
- **Market**: e.g. "UK"
- **Duration**: e.g. 24 seconds
- **Wait/Render checkbox**: if checked, run full rendering; if unchecked (dry run), just plan the production.

### 2. Execution

The screen shows a **production status block** with a progress bar and step-by-step log:
- [x] Signal generation
- [x] Script generation
- [ ] Voice synthesis
- [ ] Clip fetching
- [ ] Render orchestration
- [ ] Final package preparing

### 3. Result

Once done, the user sees a **Ready for publishing** state with:
- Video preview (if rendered)
- Title (suggested)
- Caption (suggested)
- Hashtags
- Affiliate link (generated hook)
- Download / Copy buttons for all assets.

---

## 4. MVP scope

### In scope
- One-click factory flow (Topic/Product/Market -> Package)
- Combined orchestration of existing modules
- Persistence of factory jobs in `runtime/jobs`
- Simple mobile mode UI
- Manual publish package (title, caption, clips list, render)

### Out of scope
- Automated posting (autopublish)
- Advanced analytics dashboard
- Multi-user collaboration
- Cloud rendering (keep local FFmpeg for now)

---

## 5. Backend API

### 5.1 Launch factory job
```http
POST /api/factory/run
Content-Type: application/json
```

#### Request body

```json
{
  "topic": "cockroach control London",
  "product": "gel bait",
  "market": "UK",
  "platforms": ["TikTok", "YouTube Shorts"],
  "durationSec": 24,
  "mode": "simple",
  "advanced": {
    "archetype": "problem-solution",
    "scenesCount": 4,
    "voiceId": "21m00Tcm4TlvDq8ikWAM",
    "ctaStyle": "direct",
    "renderMode": "full",
    "affiliateMode": "manual"
  }
}
```

#### Response

```json
{
  "jobId": "job_abc123",
  "status": "queued"
}
```

### 5.2 Read job
```http
GET /api/factory/jobs/:jobId
```

### 5.3 List recent jobs
```http
GET /api/factory/jobs
```

### 5.4 Retry failed job
```http
POST /api/factory/jobs/:jobId/retry
```

---

## 6. Canonical job states

### Top-level states:
- `queued`: awaiting execution
- `running`: actively processing steps
- `completed`: fully rendered and prepared
- `failed`: task error (e.g. API quota or render crash)
- `cancelled`: user stopped the job
- `requires_follow_up`: finished but partial (e.g. clips missing)

### Step-level states:
- `idle`: not started
- `active`: currently processing
- `done`: completed successfully
- `failed`: failed this step
- `cancelled`: skipped due to job cancellation

---

## 7. Job data model
Minimum MVP shape:

```json
{
  "id": "job_001",
  "topic": "cockroach control London",
  "product": "gel bait",
  "market": "UK",
  "platforms": ["TikTok"],
  "durationSec": 24,
  "mode": "simple",
  "status": "running",
  "step": "voice_generation",
  "progress": 35,
  "createdAt": "2026-03-23T12:00:00.000Z",
  "updatedAt": "2026-03-23T12:01:15.000Z",
  "result": null,
  "error": null
}
```

For MVP this can be stored in `runtime/jobs`.
Later it can sync to Supabase.

---

## 8. Final output package
When a job completes, the UI should present a single publish-ready package:

- rendered video preview / file
- title
- caption
- hashtags
- affiliate link
- publish notes
- voice asset
- source clips list
- render log / status

Final state shown to the user:

```text
Ready for publishing
```

---

## 9.1 New primary entry
Add a new primary screen:

```text
Creator OS — Factory Mode
```

This becomes the default first-run focus.

---

## 10. Advanced settings
Advanced settings accordion (default closed):
- Scenes count (default 4)
- Voice ID selector
- Platform mix (TikTok, Reels, Shorts)
- Job priority
- Mock/Force mode

---

## 11. Mobile mode
Goal: focus on result tracking and quick launch.

### Mobile UI includes only:
- Current job status
- Progress bar
- "Stop" button
- Result package copy buttons
- Video preview

### Mobile UI hides by default:
- Advanced settings
- Detailed step logs
- Archetype selection
- Historical job edits

---

## 12. Reuse strategy
- Use existing `generateScriptPlan` logic
- Use existing `generateVoiceAsset` logic
- Use existing `generateClipAssets` logic
- Use existing `renderVideoAsset` logic
- All orchestration happens in the new `executeFactoryJob` function.

---

## 13. Delivery plan

### Sprint 1 — backend orchestration
- Implement `/api/factory/run` and job loop
- Implement job read and status update logic
- Implement basic `runtime/jobs` persistence

### Sprint 2 — Factory Mode UI
- Create the Factory Mode primary screen
- Implement launch form and progress block
- Implement result package display

### Sprint 3 — UX simplification
- Collapse old modules into an "Advanced Dashboard"
- Refine mobile mode
- Add retry/cancel support

### Sprint 4 — reliability and polish
- Basic error recovery
- Loading states
- Deployment to Render v10 production

---

## 14. Definition of done
- User can input topic -> product -> market
- User sees real-time progress of those 6 steps
- User gets a video + title + caption package at the end
- Job history is persisted locally

---

## 15. Non-goal reminder
Do not build complex database schemas yet.
Do not build cloud processing yet.
Do not build automated publishing yet.
Keep it **local-first with cloud proxy** for the MVP.
