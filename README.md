# Patients intakes export

Pulls patients from the US Veterans Health API and flattens every patient's intakes into one row per intake, ready to analyse in a spreadsheet.

## How it works

1. Walks patient IDs starting at 1 and calls `GET /api/patients/{id}` with a bearer token (404s are skipped, any other non-200 stops the run, capped at 10 patients).
2. For each intake of each patient it builds a row:
   - `patientId` first, then `intakeId` (the intake's `id`), then the remaining intake fields.
   - `encounterNote` is removed.
   - `signatureId` becomes `true`/`false` depending on whether it is set.
3. Rows are grouped by patient, in the order the patients were found.

`strucutre.json` is a sample of the API response for one patient.

## Two versions

| Version | File | Output |
|---|---|---|
| Node.js | `src/index.js`, `src/patient-service.js` | Prints the rows as JSON |
| Google Apps Script | `google-sheet.js` | Writes the rows to an `Intakes` sheet (row 1 = header, one column per key) and saves `patients.csv` to Drive |

## Node.js setup

Requires Node 20.6+.

```bash
npm install
cp .env.example .env   # then set BEARER_TOKEN in .env
npm start
```

## Google Apps Script setup

1. In the target spreadsheet, open Extensions → Apps Script and paste in `google-sheet.js`.
2. In Project Settings → Script properties, add `BEARER_TOKEN` (Apps Script's equivalent of an `.env` variable).
3. Run `main()` and authorize the Sheets and Drive permissions.

Each run replaces the contents of the `Intakes` sheet and updates `patients.csv` if it already exists in Drive.

## Notes

- `.env` is git-ignored; never commit the token. Tokens expire, so refresh `BEARER_TOKEN` if requests return 401.
- Nested values such as `provider` are stored as JSON text in a single cell.
