const { fetchPatientById } = require("./patient-service");

function toIntakeRows(patientId, intakes = []) {
  console.log(
    "toIntakeRows: patient " +
      patientId +
      " has " +
      intakes.length +
      " intakes",
  );
  return intakes.map(
    ({ id: intakeId, encounterNote, signatureId, ...intake }) => ({
      patientId,
      intakeId,
      ...intake,
      signatureId: Boolean(signatureId),
    }),
  );
}

async function fetchPatientIntakes() {
  console.log("fetchPatientIntakes: start");
  const patients = [];
  const intakeRows = [];
  let patientId = 1;

  while (true) {
    try {
      const response = await fetchPatientById(patientId);
      console.log(
        "fetchPatientIntakes: patient " +
          patientId +
          " responded " +
          response.status,
      );

      if (response.status == 404) {
        patientId++;
        continue;
      }
      if (response.status !== 200) {
        console.error(
          "Reached end of records at ID " +
            patientId +
            " (Status: " +
            response.status +
            ")",
        );
        break;
      }

      const dataPayload = response.data.data;
      patients.push({ patientId, ...dataPayload });
      intakeRows.push(...toIntakeRows(patientId, dataPayload.intakes));
      patientId++;

      if (patients.length === 10) {
        break;
      }
    } catch (error) {
      console.error(
        "Error fetching patient ID " + patientId + ": " + error.message,
      );
      break;
    }
  }

  console.log(
    "fetchPatientIntakes: done, " +
      patients.length +
      " patients, " +
      intakeRows.length +
      " rows",
  );
  console.log(JSON.stringify(intakeRows, null, 2));
  return intakeRows;
}

fetchPatientIntakes();
