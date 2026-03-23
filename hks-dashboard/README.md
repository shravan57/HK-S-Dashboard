# HKS Dashboard — Netlify + GitHub Setup Guide

## What's in this folder

```
hks-dashboard/
├── index.html                    ← Your dashboard (the whole app)
├── netlify.toml                  ← Netlify configuration
├── data/
│   └── data.json                 ← All your data lives here
└── netlify/
    └── functions/
        └── save-data.js          ← Serverless function (writes data to GitHub)
```

---

## Step 1 — Create a GitHub repository

1. Go to https://github.com and sign in (or create an account)
2. Click **New repository**
3. Name it: `hks-dashboard`
4. Set to **Public** (required for free raw file access)
5. Click **Create repository**
6. Upload all files from this folder — drag and drop them in, keeping the folder structure

Your repo URL will be: `https://github.com/YOURUSERNAME/hks-dashboard`

---

## Step 2 — Get your raw data URL

Once files are uploaded to GitHub, your data file URL will be:

```
https://raw.githubusercontent.com/YOURUSERNAME/hks-dashboard/main/data/data.json
```

Copy this URL — you'll need it in Step 4.

---

## Step 3 — Create a GitHub Personal Access Token

This lets Netlify write data back to your repo when you upload new Excel files.

1. Go to GitHub → **Settings** → **Developer settings** → **Personal access tokens** → **Tokens (classic)**
2. Click **Generate new token (classic)**
3. Give it a name: `hks-dashboard-netlify`
4. Set expiration: **No expiration** (or 1 year)
5. Check the box: **repo** (full control of private repositories)
6. Click **Generate token**
7. **Copy the token immediately** — you won't see it again

---

## Step 4 — Deploy to Netlify

1. Go to https://netlify.com and sign in with your GitHub account
2. Click **Add new site** → **Import an existing project** → **Deploy with GitHub**
3. Select your `hks-dashboard` repository
4. Leave build settings as-is (Netlify will auto-detect from netlify.toml)
5. Click **Deploy site**

Your site will be live in ~1 minute at a URL like `https://amazing-name-123.netlify.app`

---

## Step 5 — Add environment variables in Netlify

1. In Netlify, go to your site → **Site configuration** → **Environment variables**
2. Add these two variables:

| Key | Value |
|-----|-------|
| `GITHUB_TOKEN` | Your personal access token from Step 3 |
| `GITHUB_REPO` | `YOURUSERNAME/hks-dashboard` |

3. Click **Save** and then **Trigger deploy** → **Deploy site** to rebuild with the new variables

---

## Step 6 — Update the dashboard with your raw URL

1. Open `index.html` in a text editor
2. Find this line (near the top of the `<script>` section):
   ```
   const GITHUB_RAW_URL = 'REPLACE_WITH_YOUR_RAW_URL';
   ```
3. Replace with your actual URL from Step 2:
   ```
   const GITHUB_RAW_URL = 'https://raw.githubusercontent.com/YOURUSERNAME/hks-dashboard/main/data/data.json';
   ```
4. Save the file and push it to GitHub (or re-upload to your repo)
5. Netlify will auto-redeploy in ~30 seconds

---

## You're done!

Your dashboard is now live at your Netlify URL. Share it with anyone — they'll all see the same data.

### How it works day-to-day

- **To update biometric/feedback data:** Click "Upload Data" in the dashboard → upload your Excel files → click "Apply & Refresh" → data is saved to GitHub → wait 5–10 seconds → dashboard reloads with new data
- **To update tech tracker:** Use the Edit/Delete/Add buttons — changes save to GitHub automatically
- **Everyone sees the same data:** Because all data comes from `data.json` in your GitHub repo

### Data file size limit

GitHub's API can handle up to ~1MB per file. If your Excel files are very large (10,000+ rows), the rawRows in data.json might grow. If that happens, contact me and we'll add row trimming.

---

## Troubleshooting

**"Loading data from GitHub..." banner never goes away**
→ Your `GITHUB_RAW_URL` is still set to the placeholder. Check Step 6.

**Upload says "Save failed"**
→ Check that `GITHUB_TOKEN` and `GITHUB_REPO` are set in Netlify env vars. Make sure the token has `repo` scope.

**Data shows but is stale after upload**
→ GitHub CDN takes 5–15 seconds to propagate. The dashboard waits 5 seconds automatically before reloading. Hard-refresh (Ctrl+Shift+R) if needed.

**Site shows 404 for the function**
→ Make sure `netlify.toml` is in the root of your repo and the `netlify/functions/` folder exists.
