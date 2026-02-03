type FormDataPayload = {
  category: string;
  date?: string; // YYYY-MM-DD
  sum: number;
};

const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null;

// ---- Theme (light/dark) toggle ----
const THEME_STORAGE_KEY = 'theme_pref_v1';
type Theme = 'light' | 'dark';

function prefersDark(): boolean {
  try {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

function getStoredTheme(): Theme | null {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (v === 'light' || v === 'dark') return v;
    return null;
  } catch {
    return null;
  }
}

function setStoredTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // ignore
  }
}

function applyTheme(theme: Theme) {
  const isDark = theme === 'dark';
  const root = document.documentElement;
  root.classList.toggle('dark', isDark);
  // When switching to light, enable a brighter day theme via data attribute on <body>
  const body = document.body;
  if (isDark) {
    body.removeAttribute('data-theme');
  } else {
    body.setAttribute('data-theme', 'bright');
  }
  const toggleBtn = document.getElementById('themeToggle') as HTMLButtonElement | null;
  const iconSun = document.getElementById('iconSun');
  const iconMoon = document.getElementById('iconMoon');
  if (toggleBtn) toggleBtn.setAttribute('aria-pressed', String(isDark));
  if (iconSun && iconMoon) {
    if (isDark) {
      iconSun.classList.add('hidden');
      iconMoon.classList.remove('hidden');
    } else {
      iconSun.classList.remove('hidden');
      iconMoon.classList.add('hidden');
    }
  }
}

function initTheme() {
  const stored = getStoredTheme();
  const initial: Theme = stored ?? (prefersDark() ? 'dark' : 'light');
  applyTheme(initial);

  const toggleBtn = document.getElementById('themeToggle');
  toggleBtn?.addEventListener('click', () => {
    const nowDark = document.documentElement.classList.contains('dark');
    const next: Theme = nowDark ? 'light' : 'dark';
    setStoredTheme(next);
    applyTheme(next);
  });

  // If user hasn't set a preference, follow system changes dynamically
  if (!stored && window.matchMedia) {
    try {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = (e: MediaQueryListEvent) => applyTheme(e.matches ? 'dark' : 'light');
      // Modern browsers: addEventListener
      if (typeof mq.addEventListener === 'function') {
        mq.addEventListener('change', handler);
      } else if (typeof (mq as any).addListener === 'function') {
        // Safari <14
        (mq as any).addListener(handler);
      }
    } catch {}
  }
}

function formatToday(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function setLoading(loading: boolean) {
  const btn = document.getElementById('submitBtn') as HTMLButtonElement | null;
  const spinner = document.getElementById('btnSpinner');
  const btnText = document.getElementById('btnText');
  const form = document.getElementById('form') as HTMLFormElement | null;
  if (btn) btn.disabled = loading;
  if (spinner) spinner.classList.toggle('hidden', !loading);
  if (btnText) btnText.textContent = loading ? 'Saving…' : 'Submit';
  if (form) {
    form.setAttribute('aria-busy', loading ? 'true' : 'false');
    const fields = form.querySelectorAll('input, select, button');
    fields.forEach((el) => {
      if (el.id !== 'submitBtn') (el as HTMLInputElement | HTMLSelectElement | HTMLButtonElement).disabled = loading;
    });
  }
}

function notify(message: string, type: 'success' | 'error' = 'success') {
  const container = document.getElementById('toaster');
  const toast = document.createElement('div');
  toast.setAttribute('role', 'alert');
  toast.className = `px-4 py-2 rounded text-white shadow border ${
    type === 'success'
      ? 'bg-green-600 border-green-700'
      : 'bg-red-600 border-red-700'
  }`;
  toast.textContent = message;
  if (container) {
    container.appendChild(toast);
  } else {
    // fallback
    toast.classList.add('fixed', 'top-4', 'right-4');
    document.body.appendChild(toast);
  }
  setTimeout(() => toast.remove(), 3500);
}

function clearFieldError(id: string) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

function showFieldError(id: string, msg?: string) {
  const el = document.getElementById(id);
  if (el) {
    if (msg) el.textContent = msg;
    el.classList.remove('hidden');
  }
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
  const categoryEl = document.getElementById('category') as HTMLSelectElement | null;
  const dateEl = document.getElementById('date') as HTMLInputElement | null;
  const sumEl = document.getElementById('sum') as HTMLInputElement | null;

  // clear previous errors
  clearFieldError('error-category');
  clearFieldError('error-sum');
  categoryEl?.classList.remove('border-red-500');
  sumEl?.classList.remove('border-red-500');

  const category = categoryEl?.value || '';
  const date = dateEl?.value || '';
  const sumStr = sumEl?.value || '';

  let firstInvalid: HTMLElement | null = null;
  if (!category) {
    showFieldError('error-category');
    categoryEl?.classList.add('border-red-500');
    firstInvalid = firstInvalid || categoryEl;
  }
  const sum = Number(sumStr.replace(',', '.'));
  if (!sumStr || Number.isNaN(sum) || sum <= 0) {
    showFieldError('error-sum');
    sumEl?.classList.add('border-red-500');
    firstInvalid = firstInvalid || sumEl;
  }
  if (firstInvalid) {
    firstInvalid.focus();
    return;
  }

  const payload: FormDataPayload = { category, sum, date: date || undefined };
  setLoading(true);

  const onSuccess = () => {
    setLoading(false);
    notify('Saved successfully');
    (document.getElementById('form') as HTMLFormElement | null)?.reset();
    populateDateDefault();
    // focus first field for quick entry
    (document.getElementById('category') as HTMLSelectElement | null)?.focus();
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
  // Initialize theme toggle first so UI paints in the correct mode
  initTheme();
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
