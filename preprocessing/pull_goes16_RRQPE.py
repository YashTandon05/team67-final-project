import datetime as dt
import json
from pathlib import Path

import cartopy.crs as ccrs
import numpy as np
from goes2go import goes_nearesttime
from goes2go.tools import abi_crs

# ============================================================
# User options
# ============================================================
satellite = 16
product = "ABI-L2-RRQPEF"
domain = "C"

start = dt.datetime(2024, 9, 23)
end = dt.datetime(2024, 9, 30)

sample_times = [dt.time(hour=h) for h in range(0, 24, 3)]  # every 2 hours

output = []

path = Path("../lib/RRQPE_helene/RRQPE_helene_3hr.ndjson")

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
            QPE = goes_nearesttime(
                satellite=satellite, attime=target_dt, product=product, domain=domain
            )
        except Exception as e:
            print(f"Skipping {target_dt}: {e}")
            continue

        # RRQPE array
        q = np.array(QPE.RRQPE)

        # projection → lat/lon conversion
        crs, x, y = abi_crs(QPE, "RRQPE")
        X, Y = np.meshgrid(x, y)
        proj = QPE["goes_imager_projection"]

        a = ccrs.PlateCarree().transform_points(x=X, y=Y, src_crs=crs)
        lats = a[:, :, 1]
        lons = a[:, :, 0]

        # mask for positive values
        rain_mask = q > 2.5  # mm/hr threshold, considered moderate rain
        if not np.any(rain_mask):
            print(f"No rain at {target_dt}")
            continue

        # mask for atlantic basin
        atl_mask = (lons >= -100) & (lons <= -40) & (lats >= 0) & (lats <= 50)

        if area_mask:
            combined_mask = rain_mask & atl_mask
        else:
            combined_mask = rain_mask

        # extract only the rainy pixels
        lat_vals = lats[combined_mask].tolist()
        lon_vals = lons[combined_mask].tolist()
        q_vals = q[combined_mask].tolist()

        # downsample
        lat_vals = lat_vals[::10]
        lon_vals = lon_vals[::10]
        q_vals = q_vals[::10]

        # individual json entry
        entry = {
            "datetime": QPE.t.dt.strftime("%Y-%m-%dT%H:%M:%SZ").item(),
            "lon": lon_vals,
            "lat": lat_vals,
            "RRQPE": q_vals,
        }

        output.append(entry)
        print(f"Collected {entry['datetime']} ({len(q_vals)} rainy pixels)")

        with open(path, "a") as f:
            json.dump(entry, f)
            f.write("\n")

    current += dt.timedelta(days=1)

print("Done.")
