type FormDataPayload = {
  category: string;
  date?: string; // YYYY-MM-DD
  sum: number;
};

const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null;

function formatToday(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function setLoading(loading: boolean) {
  const btn = $("#submitBtn") as HTMLButtonElement | null;
  if (btn) {
    btn.disabled = loading;
    btn.innerText = loading ? 'Saving…' : 'Submit';
  }
}

function notify(message: string, type: 'success' | 'error' = 'success') {
  const box = document.createElement('div');
  box.className = `fixed top-4 right-4 px-4 py-2 rounded text-white shadow ${
    type === 'success' ? 'bg-green-600' : 'bg-red-600'
  }`;
  box.textContent = message;
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 3500);
}

function populateDateDefault() {
  const dateInput = document.getElementById('date') as HTMLInputElement | null;
  if (dateInput && !dateInput.value) {
    dateInput.value = formatToday();
  }
}

function populateCategories(categories: string[]) {
  const select = document.getElementById('category') as HTMLSelectElement | null;
  if (!select) return;
  select.innerHTML = '<option value="" disabled selected>Select category</option>';
  for (const c of categories) {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    select.appendChild(opt);
  }
}

// OAuth 2.0 + Google Sheets API integration
// Config via runtime window.__CONFIG__ or Vite env vars (fallback to empty)
const RUNTIME_CLIENT_ID = (() => {
  try {
    return (window as any)?.__CONFIG__?.GOOGLE_CLIENT_ID || '';
  } catch {
    return '';
  }
})();
const CLIENT_ID = RUNTIME_CLIENT_ID || (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID || '';
const SPREADSHEET_ID = (import.meta as any).env?.VITE_SHEET_ID || '1c28xR41_PrOMWkZzDBJQEj5WG5eeoe003gbbhMuRlRA';
const RANGE = (import.meta as any).env?.VITE_SHEET_RANGE || `'February PL, zl (2026)'!A3:A31`;
// Use write scope so we can append rows to the DB sheet from the web app
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';

let gisToken: string | null = null;

// Token persistence (localStorage with TTL)
const TOKEN_STORAGE_KEY = 'gis_access_token_v1';
const TOKEN_EXP_KEY = 'gis_access_token_exp_v1';

function saveToken(token: string, expiresInSeconds = 3600) {
  try {
    const exp = Date.now() + Math.max(1, (expiresInSeconds - 30)) * 1000; // shave 30s for safety
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
    localStorage.setItem(TOKEN_EXP_KEY, String(exp));
  } catch {
    // ignore storage errors
  }
}

function loadToken(): string | null {
  try {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    const expStr = localStorage.getItem(TOKEN_EXP_KEY);
    const exp = expStr ? Number(expStr) : 0;
    if (!token || !exp || Number.isNaN(exp) || Date.now() >= exp) return null;
    return token;
  } catch {
    return null;
  }
}

function clearToken() {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(TOKEN_EXP_KEY);
  } catch {
    // ignore
  }
}

function ensureGisLoaded(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).google && (window as any).google.accounts?.oauth2) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(script);
  });
}

async function getAccessToken(): Promise<string> {
  await ensureGisLoaded();
  // Block unsupported origins early (file:// cannot be authorized as an origin)
  if (location.protocol === 'file:') {
    throw new Error('Cannot authenticate from file://. Please serve the app (e.g., `vite preview`) so the origin can be authorized in Google Cloud Console.');
  }
  if (!CLIENT_ID) {
    throw new Error('OAuth Client ID is not configured. Set VITE_GOOGLE_CLIENT_ID in .env at build time or provide window.__CONFIG__.GOOGLE_CLIENT_ID at runtime.');
  }

  // Reuse token if present in-memory
  if (gisToken) return gisToken;

  // Try cached token from storage
  const cached = loadToken();
  if (cached) {
    gisToken = cached;
    return gisToken;
  }

  return new Promise((resolve, reject) => {
    const oauth2 = (window as any).google.accounts.oauth2;
    const tc = oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: (response: any) => {
                const DEFAULT_EXPIRES_IN_SECONDS = 3600;

                const token: unknown = response?.access_token;
                if (typeof token !== 'string' || token.length === 0) {
                    reject(new Error('No access token received'));
                    return;
                }

                gisToken = token;

                const rawExpiresIn: unknown = response?.expires_in;
                const expiresInSeconds =
                    typeof rawExpiresIn === 'number' && Number.isFinite(rawExpiresIn)
                        ? rawExpiresIn
                        : DEFAULT_EXPIRES_IN_SECONDS;

                saveToken(gisToken, expiresInSeconds);
                resolve(gisToken);
            },
            error_callback: (err: any) => {
            clearToken();
                const code = err?.error || err?.type || '';
                if (code === 'redirect_uri_mismatch') {
                  reject(new Error('OAuth setup issue: redirect_uri_mismatch. Add this site\'s origin to "Authorized JavaScript origins" in your Google OAuth Client (e.g., http://localhost:5173 or your deployed URL).'));
                } else if (code === 'idpiframe_initialization_failed') {
                  reject(new Error('Failed to initialize Google Identity Services. Ensure third-party cookies are enabled and the origin is allowed.'));
                } else if (code === 'popup_closed' || code === 'access_denied') {
                  reject(new Error('Authorization was cancelled or denied. Please try again.'));
                } else {
                  reject(err);
                }
            },
        });
        tc.requestAccessToken({ prompt: '' });
    });
}

async function fetchCategoriesViaSheets(): Promise<string[]> {
  try {
    gisToken = await getAccessToken();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(SPREADSHEET_ID)}/values/${encodeURIComponent(RANGE)}?majorDimension=COLUMNS`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${gisToken}` } });
    if (res.status === 401 || res.status === 403) {
      // Token likely expired/invalid -> clear cache so next call can refresh
      clearToken();
    }
    if (!res.ok) throw new Error(`Sheets API error: ${res.status}`);
    const data = await res.json();
    const values: string[] = (data.values?.[0] || []).map((v: any) => String(v).trim()).filter((v: string) => v);
    // Deduplicate preserving order
    const seen = new Set<string>();
    const unique = values.filter(v => (seen.has(v) ? false : (seen.add(v), true)));
    return unique;
  } catch (e: any) {
    throw e;
  }
}

// Append a row to the DB sheet using Google Sheets API (frontend-only)
async function appendTransactionToDB(payload: FormDataPayload): Promise<void> {
  const dateStr = (payload.date && payload.date.trim()) || formatToday();
  const category = payload.category;
  const sum = payload.sum;
  // Acquire/refresh token with write scope
  const token = await getAccessToken();
  const range = encodeURIComponent('DB'); // target sheet name; append decides position
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(SPREADSHEET_ID)}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      majorDimension: 'ROWS',
      values: [[dateStr, category, sum]],
    }),
  });
  if (res.status === 401 || res.status === 403) {
    // token invalid or insufficient; clear so next attempt can re-auth
    clearToken();
  }
  if (!res.ok) {
    let msg = `Sheets API append failed: ${res.status}`;
    try {
      const j = await res.json();
      if (j?.error?.message) msg += ` - ${j.error.message}`;
    } catch {}
    throw new Error(msg);
  }
}

async function loadCategories() {
  try {
    const cats = await fetchCategoriesViaSheets();
    if (!cats.length) {
      notify('No categories found in the configured range', 'error');
    }
    populateCategories(cats);
  } catch (err: any) {
    notify(`Failed to load categories: ${String(err?.message || err)}`, 'error');
  }
}

// ---- Offline queue (PWA-friendly) ----
const OFFLINE_QUEUE_KEY = 'offline_tx_queue_v1';

function readQueue(): FormDataPayload[] {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr as FormDataPayload[];
    return [];
  } catch {
    return [];
  }
}

function writeQueue(q: FormDataPayload[]) {
  try {
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(q));
  } catch {
    // ignore
  }
}

function enqueue(payload: FormDataPayload) {
  const q = readQueue();
  q.push(payload);
  writeQueue(q);
}

async function flushQueue() {
  const q = readQueue();
  if (!q.length) return;
  // Try to send queued items in FIFO order
  const remaining: FormDataPayload[] = [];
  for (let i = 0; i < q.length; i++) {
    const item = q[i];
    try {
      await appendTransactionToDB(item);
    } catch (err: any) {
      const msg = String(err?.message || err || '');
      // If offline/network error, stop and keep the rest
      if (!navigator.onLine || /Failed to fetch|NetworkError|TypeError/.test(msg)) {
        remaining.push(item);
        if (i + 1 < q.length) remaining.push(...q.slice(i + 1));
        break;
      }
      // Other errors (e.g., auth) -> keep item to retry later
      remaining.push(item);
    }
  }
  writeQueue(remaining);
  if (q.length && remaining.length === 0) {
    notify('All offline items have been synced');
  }
}

function handleSubmit(e: Event) {
  e.preventDefault();
  const category = (document.getElementById('category') as HTMLSelectElement | null)?.value || '';
  const date = (document.getElementById('date') as HTMLInputElement | null)?.value || '';
  const sumStr = (document.getElementById('sum') as HTMLInputElement | null)?.value || '';

  if (!category) {
    notify('Please select a category', 'error');
    return;
  }
  const sum = Number(sumStr);
  if (!sumStr || Number.isNaN(sum)) {
    notify('Please enter a valid sum', 'error');
    return;
  }

  const payload: FormDataPayload = { category, sum, date: date || undefined };
  setLoading(true);

  const onSuccess = () => {
    setLoading(false);
    notify('Saved successfully');
    (document.getElementById('form') as HTMLFormElement | null)?.reset();
    populateDateDefault();
  };

  const onQueued = () => {
    setLoading(false);
    enqueue(payload);
    notify('You are offline. Saved locally and will sync when online');
    (document.getElementById('form') as HTMLFormElement | null)?.reset();
    populateDateDefault();
  };

  if (!navigator.onLine) {
    onQueued();
    return;
  }

  appendTransactionToDB(payload)
    .then(onSuccess)
    .catch((err: any) => {
      const msg = String(err?.message || err || '');
      if (/Failed to fetch|NetworkError|TypeError/.test(msg) || !navigator.onLine) {
        onQueued();
        return;
      }
      setLoading(false);
      notify(`Error: ${msg}`, 'error');
    });
}

async function boot() {
  populateDateDefault();
  loadCategories();
  const form = document.getElementById('form') as HTMLFormElement | null;
  form?.addEventListener('submit', handleSubmit);
  // Flush offline queue on startup and on regain connectivity
  flushQueue();
  window.addEventListener('online', () => {
    notify('Back online. Syncing…');
    flushQueue();
  });

  // Register PWA using Vite PWA plugin helper (runtime-safe)
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const { registerSW } = await import('virtual:pwa-register');
    registerSW({ immediate: true });
  } catch {}
}

document.addEventListener('DOMContentLoaded', boot);
