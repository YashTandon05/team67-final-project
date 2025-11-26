
// List of daily files to load
const dailyFiles = [
  "2024_09_23_hourly_RRQPE.json",
  "2024_09_24_hourly_RRQPE.json",
  "2024_09_25_hourly_RRQPE.json",
  "2024_09_26_hourly_RRQPE.json",
  "2024_09_27_hourly_RRQPE.json",
  "2024_09_28_hourly_RRQPE.json",
];

const basePath = "lib/";

async function fetchJSON(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch data: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error("Error fetching or parsing JSON data:", error);
    return null;
  }
}

export async function loadDailyRRQPE() {
  console.log("Starting to load daily RRQPE data...");
  const allFrames = [];

  for (const filename of dailyFiles) {
    const data = await fetchJSON(basePath + filename);
    if (!data || !data.hours) continue;

    const dateStr = data.date; // "YYYY-MM-DD"

    for (const hourObj of data.hours) {
      const hour = hourObj.hour;
      const points = hourObj.data;

      if (!points || points.length === 0) continue;

      // Construct datetime
      // dateStr is "2024-09-23", hour is integer 0..23
      // We can create an ISO string or parse manually.
      // "2024-09-23T00:00:00Z"
      const hourStr = String(hour).padStart(2, "0");
      const datetime = new Date(`${dateStr}T${hourStr}:00:00Z`);

      // Extract arrays
      const lons = new Float32Array(points.length);
      const lats = new Float32Array(points.length);
      const vals = new Float32Array(points.length);

      for (let i = 0; i < points.length; i++) {
        lons[i] = points[i].lon;
        lats[i] = points[i].lat;
        vals[i] = points[i].RRQPE;
      }

      allFrames.push({
        datetime: datetime,
        lons: lons,
        lats: lats,
        vals: vals,
        Nx: points.length, // Not grid-based anymore, but keeping for consistency if needed
        Ny: 1,
      });
    }
  }

  // Sort by time just in case, though file order should preserve it
  allFrames.sort((a, b) => a.datetime - b.datetime);

  console.log(`Finished loading daily RRQPE data. Total frames: ${allFrames.length}`);
  return allFrames;
}
