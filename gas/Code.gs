/**
 * Google Apps Script backend for Finance Google Integration
 *
 * Expected sheets structure:
 * - Categories sheet (default: first sheet): Column A contains category names.
 * - Transactions sheet (created if missing): Columns: Date (A), Category (B), Sum (C)
 */

const CATEGORIES_SHEET_INDEX = 0; // first sheet
// Target sheet to store submitted entries
// The user created a sheet named "DB"; write rows there in a simple, useful format
const TRANSACTIONS_SHEET_NAME = 'DB';

function doGet() {
  // Serve the HTML built by Vite (single-file). Create an HTML file in the
  // Apps Script project named 'index' with the content of dist/index.html.
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('Finance Entry')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getCategories() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheets()[CATEGORIES_SHEET_INDEX];
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) return [];
  const range = sheet.getRange(1, 1, lastRow, 1); // Col A
  const values = range.getValues().map(r => String(r[0]).trim()).filter(v => v);
  const unique = Array.from(new Set(values));
  return unique;
}

/**
 * @param {{category:string, date?:string, sum:number}} data
 */
function processForm(data) {
  if (!data || !data.category || typeof data.sum !== 'number') {
    throw new Error('Invalid payload');
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = Session.getScriptTimeZone() || ss.getSpreadsheetTimeZone() || 'Etc/GMT';
  const date = data.date ? new Date(data.date) : new Date();
  // Normalize to spreadsheet timezone string for display
  const dateStr = Utilities.formatDate(date, tz, 'yyyy-MM-dd');

  let tx = ss.getSheetByName(TRANSACTIONS_SHEET_NAME);
  if (!tx) {
    tx = ss.insertSheet(TRANSACTIONS_SHEET_NAME);
    tx.getRange(1, 1, 1, 3).setValues([["Date", "Category", "Sum"]]);
  }
  const nextRow = tx.getLastRow() + 1;
  tx.getRange(nextRow, 1, 1, 3).setValues([[dateStr, data.category, data.sum]]);

  // Also write the value into the current month sheet: "{Month} PL, zl ({YEAR})"
  try {
    // Build a reference to the just-inserted DB amount cell (e.g., DB!C2)
    const sourceRef = `${TRANSACTIONS_SHEET_NAME}!C${nextRow}`;
    writeToMonthSheet_(date, data.category, data.sum, tz, sourceRef);
    // Mark the DB row as processed in column D
    tx.getRange(nextRow, 4).setValue('ADDED');
  } catch (e) {
    // Don't fail the form submission if month sheet mapping fails.
    // Return diagnostic info so the client may surface it if needed.
    return { ok: true, monthWrite: { ok: false, message: String(e && e.message || e) } };
  }

  return { ok: true, monthWrite: { ok: true } };
}

/**
 * Compose the month sheet name like: "February PL, zl (2026)"
 * Based on the provided date and timezone.
 */
function composeMonthSheetName_(date, tz) {
  const monthName = Utilities.formatDate(date, tz, 'MMMM');
  const year = Utilities.formatDate(date, tz, 'yyyy');
  return `${monthName} PL, zl (${year})`;
}

/**
 * Write a single transaction into the month sheet by intersecting:
 * - Column found in header row A2:AF2 that matches the transaction date
 * - Row found in A3:A31 that matches the category
 * Puts the sum into the cell at {COLUMN}:{ROW} (overwrites existing value).
 *
 * @param {Date} date
 * @param {string} category
 * @param {number} sum
 * @param {string} tz
 * @param {string=} sourceA1 Optional A1 reference to the DB amount cell (e.g., 'DB!C2').
 */
function writeToMonthSheet_(date, category, sum, tz, sourceA1) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = composeMonthSheetName_(date, tz);
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error(`Month sheet not found: ${sheetName}`);
  }

  // Read header dates A2:AF2 (row 2, cols 1..32)
  const headerRange = sheet.getRange(2, 1, 1, 32);
  const headerValues = headerRange.getValues()[0];

  const targetCol = findDateColumnIndex_(headerValues, date);
  if (targetCol === -1) {
    throw new Error('Matching date not found in A2:AF2');
  }

  // Read categories A3:A31 (rows 3..31)
  const catsRange = sheet.getRange(3, 1, 29, 1);
  const cats = catsRange.getValues().map(r => String(r[0]).trim().toLowerCase());
  const wanted = String(category).trim().toLowerCase();
  const idx = cats.indexOf(wanted);
  if (idx === -1) {
    throw new Error('Category not found in A3:A31');
  }
  const targetRow = 3 + idx; // actual sheet row number

  const targetRange = sheet.getRange(targetRow, targetCol + 1, 1, 1);
  // Put value to {COLUMN_NAME}:{ROW_NUM}
  if (sourceA1) {
    const existingFormula = targetRange.getFormula();
    const existingValue = targetRange.getValue();

    const ref = sourceA1; // e.g., DB!C2

    if (!existingFormula) {
      // No existing formula
      if (existingValue === '' || existingValue == null) {
        // Empty cell → set direct link formula to DB value
        targetRange.setFormula(`=${ref}`);
      } else if (typeof existingValue === 'number') {
        // Existing number → turn into SUM(number, ref)
        targetRange.setFormula(`=SUM(${existingValue};${ref})`);
      } else {
        // Existing text or non-number → replace with link to DB value
        targetRange.setFormula(`=${ref}`);
      }
    } else {
      // There is an existing formula
      const f = String(existingFormula).trim();
      // Escape ref safely for regex (avoid literal regex charclass in GAS parser)
      const refEsc = ref.replace(new RegExp('[.*+?^${}()|[\\]\\\\]', 'g'), '\\$&');
      const alreadyHasRef = new RegExp(`\\b${refEsc}\\b`, 'i').test(f);
      if (alreadyHasRef) {
        // Do nothing to avoid duplicate reference
      } else if (new RegExp('^=\\s*SUM\\(', 'i').test(f)) {
        // Append to existing SUM
        const inner = f
          .replace(new RegExp('^=\\s*SUM\\(', 'i'), '')
          .replace(new RegExp('\\)\\s*$'), '');
        const newInner = inner.trim() ? `${inner};${ref}` : ref;
        targetRange.setFormula(`=SUM(${newInner})`);
      } else {
        // Wrap existing formula into SUM(<existing>, ref)
        const withoutEq = f.startsWith('=') ? f.substring(1) : f;
        targetRange.setFormula(`=SUM(${withoutEq};${ref})`);
      }
    }
  } else {
    // Fallback: set numeric value (legacy behavior)
    targetRange.setValue(sum);
  }

  return { ok: true, sheet: sheetName, row: targetRow, col: targetCol + 1 };
}

/**
 * Find column index (0-based within provided header array) matching the given date.
 * Accepts header cells that may be Date objects, numbers (date serials), or strings.
 */
function findDateColumnIndex_(headerValues, date) {
  const y = date.getFullYear();
  const m = date.getMonth();
  const d = date.getDate();

  for (let i = 0; i < headerValues.length; i++) {
    const cell = headerValues[i];
    let cellDate = null;

    if (cell instanceof Date) {
      cellDate = cell;
    } else if (typeof cell === 'number') {
      // In Apps Script, numbers shouldn't represent dates from getValues(),
      // but handle defensively: treat as serial days since 1899-12-30 (Sheets base)
      const base = new Date(Date.UTC(1899, 11, 30));
      cellDate = new Date(base.getTime() + cell * 24 * 60 * 60 * 1000);
    } else if (typeof cell === 'string') {
      // Try several formats
      const s = cell.trim();
      // yyyy-MM-dd
      const m1 = (new RegExp('^\\d{4}-\\d{2}-\\d{2}$')).test(s) ? new Date(s) : null;
      // d or dd
      const m2 = (new RegExp('^\\d{1,2}$')).test(s) ? new Date(y, m, parseInt(s, 10)) : null;
      // dd/MM/yyyy or dd.MM.yyyy
      let m3 = null;
      const m3a = s.match(new RegExp('^(\\d{1,2})[\\.\\/-](\\d{1,2})[\\.\\/-](\\d{4})$'));
      if (m3a) {
        m3 = new Date(parseInt(m3a[3], 10), parseInt(m3a[2], 10) - 1, parseInt(m3a[1], 10));
      }
      cellDate = m1 || m2 || m3;
    }

    if (cellDate &&
        cellDate.getFullYear() === y &&
        cellDate.getMonth() === m &&
        cellDate.getDate() === d) {
      return i; // 0-based within headerValues
    }
  }
  return -1;
}

/**
 * Loop over every row in the TRANSACTIONS_SHEET_NAME (DB) sheet
 * and write each record to the corresponding month sheet using
 * the existing writeToMonthSheet_ mapping.
 *
 * Expected DB columns:
 *  - A: Date (string or Date)
 *  - B: Category (string)
 *  - C: Sum (number)
 *
 * Returns a summary with processed count and per-row errors.
 */
function processAllFromDb() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(TRANSACTIONS_SHEET_NAME);
  if (!sh) throw new Error(`Sheet not found: ${TRANSACTIONS_SHEET_NAME}`);

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: true, processed: 0, errors: [] };

  const tz = Session.getScriptTimeZone() || ss.getSpreadsheetTimeZone() || 'Etc/GMT';
  // Read A..D so we can skip rows already marked as ADDED in column D
  const rows = sh.getRange(2, 1, lastRow - 1, 4).getValues(); // A=Date, B=Category, C=Sum, D=Status

  let processed = 0;
  const errors = [];

  rows.forEach((row, i) => {
    const [dateStr, category, sum, status] = row;
    // Skip rows that are already handled
    if (String(status).trim().toUpperCase() === 'ADDED') return;
    if (!category || sum === '' || sum == null) return; // skip incomplete rows

    const d = dateStr ? new Date(dateStr) : null;
    if (!d || isNaN(d.getTime())) {
      errors.push({ row: i + 2, error: 'Invalid date' });
      return;
    }

    try {
      const sourceRef = `${TRANSACTIONS_SHEET_NAME}!C${i + 2}`;
      writeToMonthSheet_(d, String(category), Number(sum), tz, sourceRef);
      // Mark this DB row as processed in column D
      sh.getRange(i + 2, 4).setValue('ADDED');
      processed++;
    } catch (e) {
      errors.push({ row: i + 2, error: String(e && e.message || e) });
    }
  });

  return { ok: true, processed, errors };
}

/**
 * Optional convenience: add a custom menu to run the batch from the UI.
 */
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('Finance')
      .addItem('Post ALL DB rows to Month', 'processAllFromDb')
      .addToUi();
  } catch (e) {
    // Non-fatal in case of UI issues
  }
}
