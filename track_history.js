// load track history from csv
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";

const track = "lib/helene_track_history.csv";
async function fetchTrackCSV(url) {
  const data = await d3.csv(track, (row) => ({
    datetime: new Date(String(row.Date)),
    lat: Number(row.Lat),
    lon: Number(row.Lon),
  }));
  return data;
}

export async function loadHeleneTrack() {
  return fetchTrackCSV(track);
}

const prediction = "lib/expert_prediction.csv";
async function fetchPrediction(url) {
  const data = await d3.csv(prediction, (row) => ({
    datetime: new Date(String(row.Date)),
    lat: Number(row.Lat),
    lon: Number(row.Lon),
  }));
  return data;
}

export async function loadExpertPrediction() {
  return fetchPrediction(prediction);
}
