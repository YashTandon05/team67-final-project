// globals
const path = "lib/DMW_helene_hourly/";
// Files are from Sep 23 to Sep 29
const startDate = new Date(2024, 8, 23); // Sep 23
const endDate = new Date(2024, 8, 29);   // Sep 29 (though file list showed up to 28, we'll check existence)

async function fetchNDJSON(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    const text = await response.text();
    // Split by newline and filter out empty lines
    const lines = text.split('\n').filter(line => line.trim() !== '');
    const data = lines.map(line => JSON.parse(line));
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
    
    // Filename format: 2024-09-23_hourly_DMW.ndjson
    const dateStr = `${yyyy}-${mm}-${dd}`;
    const fname = `${dateStr}_hourly_DMW.ndjson`;
    const fpath = path + fname;

    const frames = await fetchNDJSON(fpath);
    
    if (frames) {
      for (const obj of frames) {
        // Normalize to match RRQPE structure
        // DMW: latitudes, longitudes, wind_speeds, u_components, v_components
        
        const lons = new Float32Array(obj.longitudes);
        const lats = new Float32Array(obj.latitudes);
        const vals = new Float32Array(obj.wind_speeds);
        const u = new Float32Array(obj.u_components);
        const v = new Float32Array(obj.v_components);

        dmwData.push({
          datetime: obj.datetime, // "2024-09-23T00:00:00"
          lons: lons,
          lats: lats,
          vals: vals,
          u: u,
          v: v,
          Nx: lons.length,
          Ny: lats.length,
          type: 'wind'
        });
      }
    }
    
    currDate.setDate(currDate.getDate() + 1);
  }
  
  // Sort by datetime just in case
  dmwData.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
  
  console.log("Finished preloading DMW data. Frames:", dmwData.length);
  return dmwData;
}
