// globals
const path = "data/dev/"; // ! NOTE: change to full data path after development
const timeStrings = ["00", "12"];
const startDate = new Date(2024, 0, 1);
const endDate = new Date(2024, 0, 31); // ! NOTE: change to full year after development
export const times12Hr = [];

// preload intermediate, coarse-grained RRQPE data
async function fetchJSON(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch data: ${response.statusText}`);
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error fetching or parsing JSON data:", error);
  }
}

export async function preload12hRRQPE() {
  const rrqpe12hData = [];
  let currDate = startDate;
  console.log("Starting to preload 12-hour RRQPE data...");

  while (currDate <= endDate) {
    const yyyy = currDate.getUTCFullYear();
    const mm = String(currDate.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(currDate.getUTCDate()).padStart(2, "0");

    for (const hh of timeStrings) {
      const fname = `${yyyy}-${mm}-${dd}T${hh}.json`;
      const fpath = path + fname;

      const obj = await fetchJSON(fpath);
      if (!obj) continue;

      const lon = new Float32Array(obj.lon);
      const lat = new Float32Array(obj.lat);
      const rrqpe = new Float32Array(obj.RRQPE);

      times12Hr.push(obj.datetime);

      rrqpe12hData.push({
        datetime: obj.datetime,
        lons: lon,
        lats: lat,
        vals: rrqpe,
        Nx: lon.length,
        Ny: lat.length,
      });
    }
    currDate.setDate(currDate.getDate() + 1);
  }
  console.log("Finished preloading 12-hour RRQPE data.");
  return rrqpe12hData;
}
