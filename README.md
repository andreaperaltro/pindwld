# Pindwld

A web app that downloads all images from a Pinterest board as a ZIP file.

## Local development

```bash
npm install
npx playwright install chromium
npm start
```

Open http://localhost:3000

## Deploy to Vercel (free)

1. Push to GitHub and import the repo in [Vercel](https://vercel.com)
2. Deploy — no API keys or config needed

Note: Pinterest loads most content with JavaScript. The Vercel version uses plain HTTP fetch and may find fewer images. For full support, run locally (`npm start`) or deploy to Railway.

## Deploy to Railway

Use the Dockerfile for platforms that support it (Railway, Render, Fly.io).

## Requirements

- Node.js 18+
- Public Pinterest boards only (private boards require login)
