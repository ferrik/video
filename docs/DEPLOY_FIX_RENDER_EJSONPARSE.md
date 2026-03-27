# Render deploy fix: `npm ERR! code EJSONPARSE`

If Render build logs show errors like:

- `Unexpected token "d" ... while parsing 'diff --git a/package.json b/package.json'`
- `Expected double-quoted property name ... near ... "name": "...",\n-  "version": "..."`

then `package.json` in the repository is not JSON anymore (a git patch/diff line was pasted into the file).

## Why this happens

`package.json` must be strict JSON. If lines that start with `+` or `-` from a diff are pasted into the file, npm cannot parse it and Render fails before install.

## Fix steps

1. Open `package.json` in the repository and replace the full file with valid JSON.
2. Ensure there are no `diff --git`, `+++`, `---`, `@@`, `+`, or `-` patch markers in the JSON body.
3. Commit and push.
4. Redeploy on Render.

## Known-good `package.json` (paste this as full file)

```json
{
  "name": "creator-os-backend",
  "version": "1.0.3",
  "description": "Creator OS v10 backend and static frontend for AI-assisted content operations.",
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "check": "node --check index.js",
    "test": "node --test"
  },
  "keywords": [
    "creator-os",
    "express",
    "anthropic",
    "ffmpeg",
    "elevenlabs",
    "pexels",
    "supabase"
  ],
  "author": "",
  "license": "ISC",
  "type": "commonjs",
  "engines": {
    "node": ">=20"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.99.2",
    "axios": "^1.13.6",
    "cors": "^2.8.6",
    "dotenv": "^17.3.1",
    "express": "^5.2.1",
    "express-rate-limit": "^8.3.1",
    "ffmpeg-static": "^5.2.0"
  }
}
```

## Quick local validation

Run this command from the project root:

```bash
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package.json is valid JSON')"
```

If this validation passes, Render can proceed past `npm install`.
