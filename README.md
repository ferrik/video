# Creator OS v10

Creator OS is an AI operating system for content monetization. It is not just a dashboard and not just a script generator. It is a decision engine for finding winning content, producing video assets, and turning views into affiliate revenue.

## What this project is

Creator OS combines:

- a browser-based control panel with 25+ workflow modules
- a Node.js backend that proxies AI and orchestration requests
- a data layer for memory, metrics, and winners
- an automation layer for turning a topic into a video production job

Core idea:

```text
signal -> script -> voice -> clips -> render -> publish -> analytics -> evolution
```

The value is not "generate another video". The value is:

```text
find a winner -> learn why it worked -> scale the winner
```

## Product vision

Creator OS is designed to run an AI content factory:

- find signals worth testing
- generate short-form scripts and hooks
- create voiceover
- fetch matching stock clips
- render a short vertical video
- prepare publishing targets
- collect performance data
- identify champions and clone what works

Revenue model:

```text
video -> clicks -> affiliate sale -> commission
```

## Current architecture

### Frontend

- single-page interface in [public/index.html](/D:/Antigravity_pinterest/creator-os-backend/public/index.html)
- multi-module control panel for signals, scripts, publishing, evolution, archetypes, and portfolio

### Backend

- Express server in [index.js](/D:/Antigravity_pinterest/creator-os-backend/index.js)
- Anthropic proxy endpoint
- automation endpoints for full video jobs
- Render-ready deployment

### Data layer

- Supabase for auth and cloud sync
- local browser storage for some UI state and module data
- runtime job artifacts stored server-side in `runtime/`

### AI / automation services

- Anthropic for script generation
- ElevenLabs for voice generation
- Pexels for clip sourcing
- FFmpeg for render orchestration
- Buffer / YouTube API planned for publishing

## What is automated now

### Already implemented

- AI script generation via Anthropic
- backend orchestration for full-video jobs
- voice generation integration hook for ElevenLabs
- stock clip sourcing integration hook for Pexels
- FFmpeg render command generation and execution path
- automation job status endpoint
- Render deployment config

### Still dependent on configuration

- Supabase auth requires project URL and anon key
- ElevenLabs requires `ELEVENLABS_API_KEY`
- Pexels requires `PEXELS_API_KEY`
- publishing requires Buffer or YouTube credentials
- full render execution requires FFmpeg to be available on the server

## Automation API

### Health

```http
GET /health
```

Returns:

```json
{ "status": "ok" }
```

### Service status

```http
GET /api/automation/status
```

Returns which providers are configured and whether FFmpeg is available.

### Generate script plan

```http
POST /api/automation/script
Content-Type: application/json
```

Example body:

```json
{
  "topic": "cockroach control London",
  "product": "gel bait",
  "platform": "TikTok",
  "durationSec": 24,
  "scenesCount": 4
}
```

### Run full automation job

```http
POST /api/automation/full-video
Content-Type: application/json
```

Example body:

```json
{
  "topic": "cockroach control London",
  "product": "gel bait",
  "platform": "TikTok,YouTube Shorts,Instagram",
  "durationSec": 24,
  "dryRun": false
}
```

This endpoint orchestrates:

1. script generation
2. voice generation
3. clip sourcing
4. FFmpeg render planning/execution
5. publish planning
6. analytics planning

It returns a job object and saves it under `runtime/jobs`.

### Fetch a job

```http
GET /api/automation/jobs/:jobId
```

## Environment variables

Use [`.env.example`](/D:/Antigravity_pinterest/creator-os-backend/.env.example) as the template.

Important variables:

- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL`
- `ELEVENLABS_API_KEY`
- `ELEVENLABS_VOICE_ID`
- `PEXELS_API_KEY`
- `BUFFER_ACCESS_TOKEN`
- `YOUTUBE_API_KEY`
- `TIKTOK_SESSION_ID`
- `FFMPEG_PATH`

## Local development

1. Install dependencies:

```bash
npm install
```

2. Create a local `.env`:

```env
ANTHROPIC_API_KEY=your_anthropic_api_key_here
ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
PEXELS_API_KEY=your_pexels_api_key_here
PORT=3000
```

3. Start the server:

```bash
npm start
```

4. Open:

```text
http://localhost:3000
```

5. Check service status:

```text
http://localhost:3000/api/automation/status
```

## Render deployment

The repository includes [render.yaml](/D:/Antigravity_pinterest/creator-os-backend/render.yaml).

Recommended Render setup:

- Service type: `Blueprint`
- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/health`

Add these environment variables in Render as needed:

- `ANTHROPIC_API_KEY`
- `ELEVENLABS_API_KEY`
- `ELEVENLABS_VOICE_ID`
- `PEXELS_API_KEY`
- `BUFFER_ACCESS_TOKEN`
- `YOUTUBE_API_KEY`
- `TIKTOK_SESSION_ID`
- `FFMPEG_PATH`

## Current priority

Do not build `v11` first.

The priority is to launch `v10` with real loops:

1. produce 10 real videos
2. collect metrics
3. identify one winner
4. scale the winner

That is where the system becomes a business instead of a prototype.
