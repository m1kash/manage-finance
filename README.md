# Finance Google Integration

A minimal web form (Vite + TypeScript + Tailwind) bundled as a single HTML file. Categories are loaded via Google Sheets API with OAuth 2.0 (Google Identity Services). Optional Apps Script backend (`gas/Code.gs`) handles form submission to a `Transactions` sheet when hosted as a GAS Web App.

## Features
- Category select populated from Column A of your spreadsheet (first sheet by default)
- Date field defaults to today (local timezone)
- Sum field with basic validation
- Submits to `DB` sheet (Date, Category, Sum) directly from the web app via Google Sheets API (no Apps Script required for saving)
- Progressive Web App (PWA) via `vite-plugin-pwa`:
  - App shell cached for offline use and installable on supported browsers
  - Offline-first submission queue: entries are saved locally when offline and auto-synced when the connection is restored

## Project Structure
- `index.html`, `src/` – frontend (Vite + Tailwind)
- `gas/Code.gs`, `gas/appsscript.json` – Google Apps Script backend and manifest

## Getting Started (Local Dev)
1. Install dependencies:
   - `npm install`
2. Configure OAuth (required for categories and saving to Sheets):
   - Create a Google OAuth Client ID (type: Web application) in Google Cloud Console.
   - Add Authorized JavaScript origins you will use, e.g. `http://localhost:5173` for dev, and your deployed origin(s).
   - Create a `.env.local` at project root with:
     ```
     VITE_GOOGLE_CLIENT_ID=YOUR_CLIENT_ID.apps.googleusercontent.com
     VITE_SHEET_ID=1c28xR41_PrOMWkZzDBJQEj5WG5eeoe003gbbhMuRlRA
     VITE_SHEET_RANGE='February PL, zl (2026)'!A3:A31
     ```
     Note: opening the app via `file://` is not supported by OAuth; serve it instead.
   - Ensure your OAuth Client has the scope `https://www.googleapis.com/auth/spreadsheets` allowed (requested at runtime by the app).
3. Run dev server (HTTPS enabled):
   - `npm run dev`
   - The dev server runs on `https://localhost:5173` using a locally trusted certificate via `vite-plugin-mkcert`.
   - On first run, the plugin may install a local CA and prompt for keychain trust (macOS). Follow the prompts, then reload.
   - Add `https://localhost:5173` to your OAuth Client's Authorized JavaScript origins.
   - Note: PWA features are limited in dev. For realistic PWA testing, see the section below.

## Build Single HTML
1. Build the app:
   - `npm run build`
   The single-file HTML output will be in `build/index.html`.

## PWA (Offline + Install)
- The project uses `vite-plugin-pwa` with `registerType: 'autoUpdate'` and Workbox runtime caching.
- Registration is handled in `src/main.ts` via `virtual:pwa-register`.
- The manifest is linked in `index.html` and also defined in `vite.config.ts`.

How to test PWA locally:
- Quick check (dev, limited SW behavior): `npm run dev`
- Full PWA flow (recommended):
  1. `npm run build`
  2. `npm run preview`
  3. Open `http://localhost:4173/` (or configure `preview.https` in Vite if you need HTTPS) and check Application > Service Workers in DevTools
  4. Toggle Offline to verify the app shell loads; submit while offline to see items queued and auto-synced when you go back online

Notes:
- Google APIs are not cached; network is required to fetch categories unless they were already loaded. Submissions are queued offline and synced later.
- You can add icons to the PWA by populating the `icons` array in `vite.config.ts` and adding the files to `public/`.

### Use with Google Apps Script (optional)
2. In your Google Apps Script project (bound to your target Google Sheet):
  - Create a new HTML file named `index` and paste the content of `build/index.html` into it.
  - Add `Code.gs` (copy from `gas/Code.gs`).
  - Ensure `appsscript.json` is configured (copy from `gas/appsscript.json` if using clasp, or adjust via Editor settings).

## Spreadsheet Setup
- First sheet Column A: list of categories (one per row).
- A `DB` sheet will be created automatically with columns: Date (A), Category (B), Sum (C) if missing when using Apps Script backend; when saving directly from the web app, the `DB` sheet should exist beforehand (or create it once manually).

## Deploy
- You can host the built `build/index.html` on any static hosting. The app will authenticate via Google Identity Services and write directly to your spreadsheet.
- Apps Script Web App hosting remains optional if you prefer, but saving is now done from the frontend via the Sheets API.
— For production, ensure your deployed origin (e.g., `https://your-domain`) is added to the OAuth Client's Authorized JavaScript origins.

### Deploy to GitHub Pages (private repo)
This project is preconfigured to deploy to GitHub Pages using GitHub Actions.

Repository example: `m1kash/manage-finance`. The Pages URL will be:
- Default Pages URL: `https://m1kash.github.io/manage-finance/`

What’s already set up:
- Vite `base` is set to `/manage-finance/` in `vite.config.ts` so assets resolve under the Pages subpath.
- PWA `start_url` and `scope` are set to `/manage-finance/` and Workbox `navigateFallback` is adjusted.
- A GitHub Actions workflow at `.github/workflows/deploy.yml` builds on pushes to the `web` branch and deploys to GitHub Pages.

Steps to publish:
1. Push your code and this workflow to GitHub, and use branch `web` for deployment (or adjust the workflow trigger).
2. In GitHub, open: Settings → Pages → set Source to “GitHub Actions”.
3. In Settings → Secrets and variables → Actions → New repository secret, add:
   - `VITE_GOOGLE_CLIENT_ID`
   - `VITE_SHEET_ID`
   - `VITE_SHEET_RANGE`
4. Push to the `web` branch. The workflow will build and deploy automatically. The URL will be printed in the workflow’s summary (typically `https://m1kash.github.io/manage-finance/`).
5. In Google Cloud Console (OAuth Client), add the origin `https://m1kash.github.io` and `https://m1kash.github.io/manage-finance` to Authorized JavaScript origins.

Notes:
- Private repository: the repository can be private while the Pages site is public by default on personal accounts. To restrict access, use enterprise features or put the site behind an auth proxy (e.g., Cloudflare Access).
- If you later switch to a custom domain, change Vite `base` to `'/'` and update the PWA `start_url`/`scope` accordingly, then redeploy.

## Notes
- Timezone: Date sent is based on the user's browser local time in format `yyyy-MM-dd`.
- Error handling: Basic notifications are shown on failure.
- Runtime configuration: you may also provide the OAuth Client ID at runtime via `window.__CONFIG__.GOOGLE_CLIENT_ID` before the app script runs (e.g., by injecting a script tag on your host page). Build-time env via `VITE_GOOGLE_CLIENT_ID` remains the primary method.

## Troubleshooting
- Failed to load categories: OAuth Client ID is not configured
  - Ensure `VITE_GOOGLE_CLIENT_ID` is set in `.env.local` before building, or inject `window.__CONFIG__.GOOGLE_CLIENT_ID` at runtime.
- OAuth error 400: redirect_uri_mismatch
  - Add your app origin to "Authorized JavaScript origins" for your OAuth Client (e.g., `http://localhost:5173`, your deployed URL). Avoid opening via `file://`.
- GIS initialization issues (cookies/iframes)
  - Ensure third-party cookies are enabled or try a different browser/profile; check that your origin is allowed.
- PWA not registering in dev
  - This is expected; build and run `npm run preview` and test at `http://localhost:4173/`.
- Linting: Basic ESLint config included.
