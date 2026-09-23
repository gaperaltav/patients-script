# Plan: Flatten patient intakes into result rows

## Context
`src/index.js` walks patient IDs, calls `fetchPatientById` (`src/patient-service.js`) and collects each
patient payload (shape in `strucutre.json`) into `patients[]`, then just prints it. We need a new flat
array where **each intake of each patient is one row**.

Relevant shape (`strucutre.json`): `data.intakes` is an array (21 in the sample). Each intake has
`id, chiefComplaint, dateService, timeService, purpose, purposeText, location, locationText, remark,
status, statusText, patientId, patient, encounterNote (large object), administrationVisit, contacts,
providerId, provider{id,fullName}, signatureId (number | null), signature`.

## Current flow
1. `fetchPatientIntakes()` loops `patientId = 1..`, `await fetchPatientById(patientId)` (axios, `validateStatus: () => true`, so never throws on HTTP status).
2. 404 → skip to next ID; non-200 → stop; 200 → `patients.push({ patientId, ...response.data.data })`; stops after 10 patients.
3. Prints `patients` as JSON.

## Row rules
- `patientId` is the first key of each row, followed by `intakeId` (the intake's `id`, renamed), then the remaining intake properties.
- Drop `encounterNote`.
- `signatureId` → `true` if truthy, `false` if falsy (`null`, `undefined`, `0`, `""`). Key name kept as `signatureId`, value becomes boolean; the separate `signature` field is left untouched.
- A null/falsy `signatureId` never removes the row: the intake is still emitted, just with `signatureId: false`.
- Rows are ordered patient by patient: all intakes of patient A (in API order), then the first intake of the next found patient, etc. Patients with no intakes contribute no rows.

## Changes (only `src/index.js`; `patient-service.js` unchanged)
1. Add a pure helper above `fetchPatientIntakes`:
   ```js
   function toIntakeRows(patientId, intakes = []) {
     return intakes.map(({ id: intakeId, encounterNote, signatureId, ...intake }) => ({
       patientId,
       intakeId,
       ...intake,
       signatureId: Boolean(signatureId),
     }));
   }
   ```
   - Destructuring renames `id` to `intakeId` (rows no longer have an `id` key) and removes `encounterNote`; `patientId` is put first, so it leads the key order (it overrides the intake's own `patientId`, which has the same value).
   - `Boolean(signatureId)` maps any truthy value to `true` and any falsy value (including `null`) to `false`; no filtering is done, so every intake yields a row.
   - `intakes = []` default guards against a payload with a missing/undefined `intakes`.
2. Add `const intakeRows = [];` next to `const patients = [];`.
3. In the 200 branch, after `const dataPayload = response.data.data;`, add
   `intakeRows.push(...toIntakeRows(patientId, dataPayload.intakes));`
   Because it is pushed inside the loop in fetch order, the "next patient's first intake follows the previous patient's last intake" rule falls out naturally. Use `push(...)` (flat), not `push([...])`.
4. At the end, print/return `intakeRows` instead of (or in addition to) `patients`:
   `console.log(JSON.stringify(intakeRows, null, 2));` and `return intakeRows;`.
5. Optional cleanup (not required): remove the debug `console.log({ data: response.data.data })` at `index.js:15`, since it dumps every encounter note.

## Notes / assumptions to confirm
- `signatureId` is kept as the key name holding a boolean. If a different name is wanted (e.g. `signed`), change it in the helper.
- The existing 10-patient cap and 404-skip behavior are left as is (a 404 on every ID would loop forever, pre-existing).
- `patients[]` is still built; drop it if only the flat rows are needed.

## Verification
- `npm start` and inspect output: first row has `patientId` then `intakeId` as its first keys, no row has an `id` key, no row contains `encounterNote`, `signatureId` is only `true`/`false`.
- Against `strucutre.json` (patient 5, 21 intakes): expect 21 rows, exactly 2 with `signatureId: false` (positions 19 and 21).
- Offline check of the helper: `node -e` requiring the sample JSON and calling `toIntakeRows(5, d.intakes)` (export the helper or copy it into the one-off script).
- With 2+ patients, confirm rows are grouped by patient and ordered by patient ID.

## Google Sheet implementation
Goal: an Apps Script version of the same logic that writes the rows to a Google Sheet instead of printing JSON. New file: `google-sheet.js` (project root, next to `src/`; pasted into the Apps Script editor as `google-sheet.gs`/`Code`). The Node files stay untouched.

Apps Script differences from the Node flow: no `require`/`axios`/`module.exports` (all files share one global scope, so `google-sheet.js` must be self-contained), HTTP goes through `UrlFetchApp`, and secrets go in Script Properties rather than source.

### Steps
1. **Create `google-sheet.js`** with a config block and a self-contained copy of the logic:
   - `BASE_URL` (same as `patient-service.js`), `SHEET_NAME = "Intakes"`, `MAX_PATIENTS = 10`.
   - Bearer token read at runtime: `PropertiesService.getScriptProperties().getProperty("BEARER_TOKEN")` (set once in Project Settings → Script properties; not hard-coded).
2. **`fetchPatientById(patientId)`** (Apps Script port of `patient-service.js`):
   ```js
   UrlFetchApp.fetch(BASE_URL + patientId, {
     method: "get",
     headers: { accept: "application/json", authorization: "Bearer " + token },
     muteHttpExceptions: true,   // same role as axios validateStatus: () => true
   });
   ```
   Callers use `response.getResponseCode()` and `JSON.parse(response.getContentText())` in place of `response.status` / `response.data`.
3. **`toIntakeRows(patientId, intakes)`**: identical to the helper above (`intakeId` rename, `encounterNote` dropped, `Boolean(signatureId)`).
4. **`collectIntakeRows()`**: same loop as `fetchPatientIntakes` (404 → next ID, non-200 → stop, 200 → `rows.push(...toIntakeRows(...))`, stop at `MAX_PATIENTS`); `console.error` → `Logger.log`; returns the flat array (no printing).
5. **`buildSheetValues(rows)`** – turns rows into a 2D array:
   - Header row = column names built from the keys of the rows, in first-seen order (union across all rows, so a key missing on the first row still gets a column). With current data this starts `patientId, intakeId, chiefComplaint, …`.
   - One data row per object; each cell = `row[header]` for that column.
   - Cell normalisation: `null`/`undefined` → `""`; booleans stay booleans (`TRUE`/`FALSE` in Sheets); objects/arrays (e.g. `provider`) → `JSON.stringify(value)`; strings/numbers unchanged. Every row has the same width as the header (missing key → `""`), which `setValues` requires.
   - Empty `rows` → return just `[]` and skip the write (avoid `getRange(…, 0 columns)` error).
6. **`writeToSheet(values)`**:
   - `const ss = SpreadsheetApp.getActiveSpreadsheet();` (script bound to the target Sheet; alternatively `SpreadsheetApp.openById(<id from Script Properties>)` for a standalone script).
   - `const sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);`
   - `sheet.clearContents();` so re-runs replace old data.
   - `sheet.getRange(1, 1, values.length, values[0].length).setValues(values);` – a single batched write (row 1 = header, rows 2..n = data).
   - Optional: `sheet.setFrozenRows(1)`.
7. **Entry point `main()`** (run from the editor or a trigger): `writeToSheet(buildSheetValues(collectIntakeRows()))`.

### Assumptions to confirm
- Script is **bound to the target spreadsheet** (Extensions → Apps Script) and writes to a tab named `Intakes`, replacing its contents on every run.
- Nested values such as `provider` are stored as JSON text in one cell (keeps "one column per object key"). Alternative: flatten to `provider.id` / `provider.fullName` columns.
- The bearer token is stored in Script Properties (`BEARER_TOKEN`); note the current token in `patient-service.js` is hard-coded and expires, so it will need refreshing.
- Apps Script's 6-minute execution limit is fine for the 10-patient cap; a larger crawl would need batching.

### Verification (Google Sheet)
- Paste `google-sheet.js` into the bound script, set `BEARER_TOKEN`, run `main()` and authorise the scopes (external requests + spreadsheets).
- Sheet `Intakes`: row 1 is the header with `patientId`, `intakeId`, … as the first columns, no `id` or `encounterNote` column; row 2+ has one intake per row.
- For patient 5: 21 data rows; `signatureId` shows `FALSE` on exactly 2 rows; `provider` cell holds the JSON text.
- Re-run `main()`: the sheet is replaced, not appended.
- Offline sanity check before pasting: run `buildSheetValues` under Node against `strucutre.json` (pure function, no Apps Script APIs) and check header/row widths match.
