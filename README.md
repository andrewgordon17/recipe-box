# 🍳 Recipe Box

A tiny, free, GitHub-hosted recipe collector.

- **Email a link** (with an optional note) to a dedicated Gmail address.
- A Google Apps Script grabs the link, fetches the recipe **title**, and saves it to this repo.
- Visit your **GitHub Pages site** (behind a password) to **search** everything you've sent.

```
  📧 email a link ──▶ Gmail inbox ──▶ Apps Script (every 5 min) ──▶ recipes.json ──▶ 🌐 GitHub Pages site
       + a note                         (fetches the title)         (in this repo)      (password-gated, searchable)
```

Everything below is free and needs no custom domain.

---

## What's in here

| File | What it is |
|------|------------|
| `index.html` | The website — password gate + searchable recipe list. |
| `recipes.json` | The data. The script appends to it; the site reads it. (Ships with one example entry — delete it whenever.) |
| `apps-script/Code.gs` | The email → GitHub glue that runs in Google Apps Script. |
| `apps-script/appsscript.json` | Permissions manifest for the script. |

---

## Setup (about 15 minutes, one time)

### 1. Create the GitHub repo
1. Make a new **public** repo (e.g. `recipe-box`).
2. Upload these files (or `git push` them). Keep `recipes.json` at the repo root.

### 2. Turn on GitHub Pages
1. Repo **Settings → Pages**.
2. **Source:** *Deploy from a branch*. **Branch:** `main`, folder `/ (root)`. Save.
3. After a minute your site is live at `https://YOUR_USERNAME.github.io/recipe-box/`.
4. Open it — the default password is **`recipes`**. (You'll change this in step 6.)

### 3. Set your password
1. Pick a password.
2. Open any browser's dev console (F12) and run, replacing `YOUR_PASSWORD`:
   ```js
   crypto.subtle.digest('SHA-256', new TextEncoder().encode('YOUR_PASSWORD'))
     .then(b => console.log([...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')))
   ```
3. Copy the printed 64-character string into `index.html`, replacing the value of `PASSWORD_HASH`. Commit.

> ⚠️ This is a light gate, not real security. Because the repo is public, anyone who finds it can read `recipes.json` directly. That's the tradeoff you chose for "free + simple." Don't email in anything sensitive.

### 4. Create the dedicated Gmail
Make a new Gmail account, e.g. `yourname.recipes@gmail.com`. This is the address you'll email/forward recipe links to. (Using a fresh account keeps the script away from your personal mail.)

### 5. Create a GitHub token (so the script can write to the repo)
1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. **Repository access:** Only select repositories → your `recipe-box` repo.
3. **Permissions:** Repository permissions → **Contents: Read and write**.
4. Generate and **copy the token** (you only see it once).

### 6. Deploy the Apps Script
1. Sign in to the **dedicated Gmail**, go to <https://script.google.com>, **New project**.
2. Paste the contents of `apps-script/Code.gs` over the default `Code.gs`.
3. (Optional but recommended) Click the gear ⚙️ → **Show "appsscript.json"**, then paste in `apps-script/appsscript.json`.
4. **Project Settings (⚙️) → Script properties → Add script property**, add these:
   | Property | Value |
   |----------|-------|
   | `GITHUB_TOKEN` | the token from step 5 |
   | `GITHUB_OWNER` | your GitHub username |
   | `GITHUB_REPO` | `recipe-box` |
   | `GITHUB_BRANCH` | `main` |
   | `ALLOWED_SENDERS` | comma-separated whitelist of sender addresses, e.g. `me@gmail.com, partner@gmail.com` |
5. In the editor, select the **`processInbox`** function and click **Run**. Approve the permission prompts (Gmail + external requests) — use the dedicated account.
6. Select **`createTrigger`** and click **Run** once. This schedules `processInbox` to run every 5 minutes.

Done. ✅

---

## Using it

**Email a recipe in:** send (or forward) an email to your dedicated Gmail with the recipe link anywhere in the subject or body. Anything else you type becomes the **note** (searchable on the site). Only emails **from an address in `ALLOWED_SENDERS`** are accepted — anything else is silently ignored. (Forwarding note: the script checks the *From* address of the email it receives, so forward from a whitelisted account.)

```
To: yourname.recipes@gmail.com
Subject: try for the dinner party
Body: https://www.seriouseats.com/the-best-chili-recipe
      double the cumin, skip the beans
```

Within ~5 minutes it appears on your site with the real recipe title, the source, your note, and the date.

**Texting a link:** there's no SMS receiver in this free setup. From a phone it's one tap: open the link, **Share → Mail**, send to your recipes address. (If you later want a true "text a number" path, that needs a paid Twilio number — ask and I'll add it.)

**Viewing/searching:** go to your Pages URL, enter the password, and type in the search box. It matches across titles, notes, site names, and sender.

---

## How the title is found
The script fetches the page and looks, in order, for:
1. A `schema.org/Recipe` **JSON-LD** block (most recipe sites have one) → uses its `name`.
2. The **`og:title`** meta tag.
3. The plain `<title>` tag.

This works on the large majority of recipe sites. If a title ever comes out ugly, you can edit that entry directly in `recipes.json`.

---

## Troubleshooting
- **Nothing shows up after emailing:** in Apps Script, open **Executions** (left sidebar) to see logs/errors. Re-check the four Script properties and that the email was actually unread in the Inbox.
- **`GitHub write failed: 403/404`:** the token lacks **Contents: write**, or `GITHUB_OWNER`/`GITHUB_REPO` is wrong.
- **Site shows "Could not load recipes.json":** make sure `recipes.json` is at the repo root and Pages has finished deploying.
- **A recipe got skipped:** the script ignores emails with no link, emails from senders not in `ALLOWED_SENDERS`, and de-dupes by URL (the same link won't be added twice). The **Executions** log says which.
