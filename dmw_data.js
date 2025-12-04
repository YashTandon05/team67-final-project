// globals
const path = "lib/DMW_helene_3hr/";
// Files are from Sep 23 to Sep 29
const startDate = new Date(2024, 8, 23); // Sep 23
const endDate = new Date(2024, 8, 29);   // Sep 29
const timeStrings = ["00", "03", "06", "09", "12", "15", "18", "21"];

async function fetchJSON(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      // It's possible some files are missing, just return null
      return null;
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.warn("Error fetching DMW data:", url, error);
    return null;
  }
}

export async function loadDMWData() {
  const dmwData = [];
  let currDate = new Date(startDate);
  console.log("Starting to preload DMW data...");

  while (currDate <= endDate) {
    const yyyy = currDate.getUTCFullYear();
    const mm = String(currDate.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(currDate.getUTCDate()).padStart(2, "0");

    for (const hh of timeStrings) {
      // Filename format: 2024-09-23T00.json
      const fname = `${yyyy}-${mm}-${dd}T${hh}.json`;
      const fpath = path + fname;

      const obj = await fetchJSON(fpath);
      if (!obj) continue;

      // Normalize to match RRQPE structure
      // DMW: latitudes, longitudes, wind_speeds
      // RRQPE: lats, lons, vals
      
      const lons = new Float32Array(obj.longitudes);
      const lats = new Float32Array(obj.latitudes);
      const vals = new Float32Array(obj.wind_speeds);

      dmwData.push({
        datetime: obj.datetime, // "2024-09-23T00:00:00"
        lons: lons,
        lats: lats,
        vals: vals,
        Nx: lons.length,
        Ny: lats.length,
        type: 'wind'
      });
    }
    currDate.setDate(currDate.getDate() + 1);
  }
  
  // Sort by datetime just in case
  dmwData.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
  
  console.log("Finished preloading DMW data. Frames:", dmwData.length);
  return dmwData;
}
