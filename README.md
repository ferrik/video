# Creator OS v10

Creator OS v10 is a Node.js + Express backend with a static HTML/JS frontend for AI-assisted content operations. The app serves the UI from `public/`, proxies AI requests through a backend endpoint, and supports Supabase-based auth and sync.

## What is included

- Static frontend in `public/index.html`
- Express server in `index.js`
- `POST /api/chat` proxy for Anthropic
- Rate limiting for API requests
- Vercel deployment config in `vercel.json`

## Tech stack

- Node.js
- Express
- Axios
- Anthropic API
- Supabase Auth / storage integration
- Vercel

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Create a local `.env` file from `.env.example` and set your backend variables:

```env
ANTHROPIC_API_KEY=your_anthropic_api_key_here
PORT=3000
```

3. Start the app:

```bash
npm start
```

4. Open `http://localhost:3000`.

## Supabase setup

The frontend no longer contains hardcoded project credentials. Configure Supabase in the app UI and save:

- Project URL
- Public anon key

Those values are stored in browser `localStorage` under `cos4_supabase`. After saving them, reload the page.

## Deployment notes

- `vercel.json` is already configured for the Express entrypoint.
- Add `ANTHROPIC_API_KEY` in your hosting provider environment variables.
- Do not commit `.env` files or private keys.

## Render deployment

This repository now includes `render.yaml` for a simple Render Web Service setup.

Required Render environment variables:

- `ANTHROPIC_API_KEY`
- `PORT` is provided automatically by Render

Health check path:

- `/health`

If you deploy from the Render dashboard manually, use:

- Build command: `npm install`
- Start command: `npm start`

## GitHub checklist

- Secrets removed from tracked example files
- `node_modules` and local env files ignored
- Archive artifacts ignored by default
- README added for onboarding
- Line ending normalization added via `.gitattributes`

## Suggested first push

```bash
git init -b main
git add .
git commit -m "Initial commit"
git remote add origin <your-github-repo-url>
git push -u origin main
```

## Project notes

There is an additional product description document in `creator-os-full-description.docx` that can be kept in the repository if you want business/context documentation alongside the codebase.
