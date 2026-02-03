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
2. Add environment variable: **BROWSERLESS_API_KEY** = your token from [browserless.io](https://browserless.io) (free tier: 1000 units/month)
3. Deploy

## Deploy to Railway

Use the Dockerfile for platforms that support it (Railway, Render, Fly.io).

## Requirements

- Node.js 18+
- Public Pinterest boards only (private boards require login)
