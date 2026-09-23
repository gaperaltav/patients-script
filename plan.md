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
Goal: an Apps Script version of the same logic that writes the rows to a Google Sheet instead of printing JSON. File: `google-sheet.js` (project root, next to `src/`; pasted into the Apps Script editor). The Node files stay independent.

Apps Script differences from the Node flow: no `require`/`axios`/`module.exports` (all files share one global scope, so `google-sheet.js` must be self-contained), HTTP goes through `UrlFetchApp`, logging through `Logger.log`, and secrets go in Script Properties rather than source or `.env`.

### Steps
1. **Config constants**: `BASE_URL` (same as `patient-service.js`), `SHEET_NAME = "Intakes"`, `CSV_FILE_NAME = "patients.csv"`, `MAX_PATIENTS = 10`.
2. **`getBearerToken()`**: reads `BEARER_TOKEN` from `PropertiesService.getScriptProperties()` (set once in Project Settings → Script properties) and throws `Missing script property BEARER_TOKEN` if absent. The token is never hard-coded or logged.
3. **`fetchPatientById(patientId, token)`**: Apps Script port of `patient-service.js`:
   ```js
   UrlFetchApp.fetch(BASE_URL + patientId, {
     method: "get",
     headers: { accept: "application/json", authorization: "Bearer " + token },
     muteHttpExceptions: true,   // same role as axios validateStatus: () => true
   });
   ```
4. **`toIntakeRows(patientId, intakes = [])`**: same as the Node helper plus the provider change (`id` renamed to `intakeId`, `encounterNote` and `providerId` dropped, `patientId` first, `signatureId: Boolean(signatureId)`):
   ```js
   intakes.map(({ id: intakeId, encounterNote, providerId, signatureId, ...intake }) => ({
     patientId,
     intakeId,
     ...intake,
     provider: intake.provider?.fullName ?? "",
     signatureId: Boolean(signatureId),
   }));
   ```
   - `providerId` is removed by destructuring, so it never becomes a column.
   - The API's `provider` object (`{"id":6,"fullName":"Emil De Los Santos"}`) is replaced by just its `fullName`. `provider` is *not* destructured out: it stays inside `...intake` and is overridden in place, so the `provider` column keeps its original position (before `signature`). A missing/null provider gives `""`.
5. **`collectIntakeRows()`**: reads the token once, then loops from ID 1: `response.getResponseCode()` 404 → next ID; non-200 → log "Reached end of records" and stop; 200 → `JSON.parse(response.getContentText()).data`, `rows.push(...toIntakeRows(...))`, count the patient; stops at `MAX_PATIENTS`; a thrown error is logged and stops the loop. Returns the flat `rows` array (nothing printed).
6. **`toCellValue(value)`**: `null`/`undefined` → `""`; any remaining objects/arrays → `JSON.stringify` (no longer hit by `provider`, now a plain string); everything else unchanged (booleans stay booleans).
7. **`buildSheetValues(rows)`**: empty `rows` → log and return `[]`. Otherwise header = union of row keys in first-seen order (starts `patientId, intakeId, chiefComplaint, …`), body = one array per row via `toCellValue`, so every row has the header's width. Returns `[headers, ...body]`.
8. **`writeToSheet(values)`**: empty → log and return. Otherwise `SpreadsheetApp.getActiveSpreadsheet()`, get or create the `Intakes` tab, `clearContents()`, one batched `getRange(1, 1, rows, cols).setValues(values)` (row 1 = header, 2..n = data), `setFrozenRows(1)`.
9. **Logging**: every function logs its start/result with a `functionName:` prefix (counts, response status per patient, columns written); the per-cell helpers `toCellValue` and `toCsvField` are not logged to avoid thousands of lines.
10. **Entry point `main()`**: `writeToSheet(buildSheetValues(collectIntakeRows()))`, with start/done logs. Run it from the editor or a trigger.

### CSV export (defined but not called from `main()`)
- `toCsvField(value)`: quotes fields containing `,`, `"`, `\r` or `\n`, doubling inner quotes.
- `toCsv(values)`: joins fields with `,` and rows with `\r\n`.
- `writeToCsvFile(values)`: empty → log and return; otherwise `DriveApp.getFilesByName("patients.csv")` → if found, `setContent(csv)` (no duplicates), else `DriveApp.createFile("patients.csv", csv, MimeType.CSV)`; logs the file URL.
- To enable it, add `writeToCsvFile(values)` to `main()` (build `values` once and pass it to both writers).

### Assumptions to confirm
- Script is **bound to the target spreadsheet** (Extensions → Apps Script) and writes to a tab named `Intakes`, replacing its contents on every run.
- The sheet has no `providerId` column and `provider` holds only the provider's `fullName` (the provider `id` is not exported). The Node script (`src/index.js`) still outputs `providerId` and the full `provider` object; say if it should match.
- The bearer token lives in Script Properties (`BEARER_TOKEN`) and expires, so it needs refreshing.
- The 6-minute Apps Script execution limit is fine for the 10-patient cap; a larger crawl would need batching.
- A 404 on every ID loops forever (same as the Node version); no ID limit is set.

### Verification (Google Sheet)
- Paste `google-sheet.js` into the bound script, set `BEARER_TOKEN`, run `main()` and authorise the spreadsheet and external-request scopes (plus Drive if the CSV export is enabled).
- Sheet `Intakes`: row 1 is the header with `patientId`, `intakeId`, … first, no `id`, `encounterNote` or `providerId` column; row 2+ has one intake per row.
- For patient 5: 21 data rows; `signatureId` is `FALSE` on exactly 2 rows; the `provider` cell shows just the name (e.g. `Emil De Los Santos`), not JSON.
- Re-run `main()`: the sheet is replaced, not appended. The execution log shows the per-function messages and ends with `main: done`.
- If the CSV export is enabled: a single `patients.csv` in Drive, updated (not duplicated) on re-runs.
- Offline sanity check: run `buildSheetValues` / `toCsv` under Node against `strucutre.json` and check header and row widths match.
