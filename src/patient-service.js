const axios = require("axios");

const baseUrl =
  "http://usveteranshealth-hehtfubcf3bnc5gs.eastus-01.azurewebsites.net/api/patients/";
const bearerToken = process.env.BEARER_TOKEN;

if (!bearerToken) {
  throw new Error(
    "Missing BEARER_TOKEN environment variable (see .env.example)",
  );
}

async function fetchPatientById(patientId) {
  const url = baseUrl + patientId;
  console.log("fetchPatientById: GET " + url);

  return axios.get(url, {
    headers: {
      accept: "application/json",
      authorization: "Bearer " + bearerToken,
    },
    validateStatus: () => true,
  });
}

module.exports = { fetchPatientById };
