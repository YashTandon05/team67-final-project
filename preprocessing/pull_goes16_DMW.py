import datetime as dt
import json
from pathlib import Path

import cartopy.crs as ccrs
import numpy as np
from goes2go.data import goes_nearesttime
from goes2go.tools import abi_crs

# ============================================================
# User options
# ============================================================
satellite = 16
product = "ABI-L2-DMWVF"
domain = "C"

# helene: sept 23 - sept 30
# milton: oct 5 - oct 12

start = dt.datetime(2024, 10, 5)
end = dt.datetime(2024, 10, 12)
sample_times = [dt.time(hour=h) for h in range(0, 24, 3)]  # every 3 hours

output = []
path = Path("../lib/DMW_milton/DMW_milton_3hr.ndjson")

area_mask = True  # apply atlantic basin mask

# ============================================================
# Extraction loop
# ============================================================

current = start
while current < end:
    print(f"Processing date: {current.date()}")
    for t in sample_times:
        target_dt = dt.datetime(
            current.year, current.month, current.day, t.hour, t.minute
        )

        try:
            w = goes_nearesttime(
                satellite=satellite, attime=target_dt, product=product, domain=domain
            )

        except Exception as e:
            print(f"Skipping {target_dt}: {e}")
            continue

        wind_speed = np.array(w.wind_speed)

        lons = np.array(w.lon)
        lats = np.array(w.lat)

        # mask for atlantic basin
        atl_mask = (lons >= -100) & (lons <= -40) & (lats >= 0) & (lats <= 50)

        lat_vals = lats[atl_mask].tolist()
        lon_vals = lons[atl_mask].tolist()
        speed_vals = wind_speed[atl_mask].tolist()

        # downsample
        lat_vals = lat_vals[::2]
        lon_vals = lon_vals[::2]
        speed_vals = speed_vals[::2]

        entry = {
            "datetime": target_dt.isoformat(),
            "latitudes": lat_vals,
            "longitudes": lon_vals,
            "wind_speeds": speed_vals,
        }

        output.append(entry)

        print(f"  Extracted {len(lat_vals)} high-wind pixels at {target_dt}")

        with open(path, "a") as f:
            json.dump(entry, f)
            f.write("\n")

    current += dt.timedelta(days=1)

print(f"Data extraction complete. Total entries: {len(output)}")
