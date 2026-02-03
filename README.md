# Pindwld

A web app that downloads all images from a Pinterest board as a ZIP file.

## Setup

```bash
npm install
npx playwright install chromium
```

## Run

```bash
npm start
```

Open http://localhost:3000, paste a Pinterest board URL, and click **Download images**.

## Deploy to Railway

1. Push this repo to GitHub
2. Go to [railway.app](https://railway.app) and sign in
3. **New Project** → **Deploy from GitHub repo** → select `pindwld`
4. Railway will detect the Dockerfile and deploy
5. Click **Settings** → **Generate Domain** to get your public URL

## Requirements

- Node.js 18+
- Public Pinterest boards only (private boards require login)
