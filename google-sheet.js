const BASE_URL =
  "http://usveteranshealth-hehtfubcf3bnc5gs.eastus-01.azurewebsites.net/api/patients/";
const SHEET_NAME = "Intakes";
const CSV_FILE_NAME = "patients.csv";
const MAX_PATIENTS = 10;

function getBearerToken() {
  const token =
    PropertiesService.getScriptProperties().getProperty("BEARER_TOKEN");
  if (!token) {
    throw new Error("Missing script property BEARER_TOKEN");
  }
  return token;
}

function fetchPatientById(patientId, token) {
  return UrlFetchApp.fetch(BASE_URL + patientId, {
    method: "get",
    headers: {
      accept: "application/json",
      authorization: "Bearer " + token,
    },
    muteHttpExceptions: true,
  });
}

function toIntakeRows(patientId, intakes = []) {
  return intakes.map(
    ({ id: intakeId, encounterNote, signatureId, ...intake }) => ({
      patientId,
      intakeId,
      ...intake,
      signatureId: Boolean(signatureId),
    }),
  );
}

function collectIntakeRows() {
  const token = getBearerToken();
  const rows = [];
  let patientsFound = 0;
  let patientId = 1;

  while (true) {
    try {
      const response = fetchPatientById(patientId, token);
      const status = response.getResponseCode();

      if (status === 404) {
        patientId++;
        continue;
      }

      if (status !== 200) {
        Logger.log(
          "Reached end of records at ID " +
            patientId +
            " (Status: " +
            status +
            ")",
        );
        break;
      }

      const dataPayload = JSON.parse(response.getContentText()).data;
      rows.push(...toIntakeRows(patientId, dataPayload.intakes));
      patientsFound++;
      patientId++;

      if (patientsFound === MAX_PATIENTS) {
        break;
      }
    } catch (error) {
      Logger.log(
        "Error fetching patient ID " + patientId + ": " + error.message,
      );
      break;
    }
  }

  return rows;
}

function toCellValue(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return value;
}

function buildSheetValues(rows) {
  if (rows.length === 0) {
    return [];
  }

  const headers = [];
  const seen = new Set();
  rows.forEach((row) => {
    Object.keys(row).forEach((key) => {
      if (!seen.has(key)) {
        seen.add(key);
        headers.push(key);
      }
    });
  });

  const body = rows.map((row) => headers.map((key) => toCellValue(row[key])));
  return [headers, ...body];
}

function writeToSheet(values) {
  if (values.length === 0) {
    Logger.log("No intake rows to write");
    return;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);

  sheet.clearContents();
  sheet.getRange(1, 1, values.length, values[0].length).setValues(values);
  sheet.setFrozenRows(1);
}

function toCsvField(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function toCsv(values) {
  return values.map((row) => row.map(toCsvField).join(",")).join("\r\n");
}

function writeToCsvFile(values) {
  if (values.length === 0) {
    Logger.log("No intake rows to write");
    return;
  }

  const csv = toCsv(values);
  const existing = DriveApp.getFilesByName(CSV_FILE_NAME);

  if (existing.hasNext()) {
    existing.next().setContent(csv);
    return;
  }

  DriveApp.createFile(CSV_FILE_NAME, csv, MimeType.CSV);
}

function main() {
  const values = buildSheetValues(collectIntakeRows());
  writeToSheet(values);
  writeToCsvFile(values);
}
