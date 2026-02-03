# Deploy Pindwld to Railway

Run these commands in your terminal (one-time setup, then deploy):

## 1. Login to Railway

```bash
cd /Users/andreaperato/my-sketches/pindwld
npx @railway/cli login
```

This opens your browser — sign in with GitHub and authorize Railway.

## 2. Create project and deploy

```bash
npx @railway/cli init
npx @railway/cli up
```

When asked "What is your project's root directory?", press Enter (current folder is correct).

## 3. Generate a public URL

```bash
npx @railway/cli domain
```

This creates a URL like `pindwld-production-xxxx.up.railway.app`. Use that URL to access your app.

---

**Or use the Railway dashboard:** Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo → select `andreaperaltro/pindwld`. Then go to Settings → Networking → Generate Domain.
