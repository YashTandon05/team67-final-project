import json
import datetime as dt
import numpy as np

from goes2go import goes_nearesttime
from goes2go.tools import abi_crs
import cartopy.crs as ccrs

# ============================================================
# User options
# ============================================================
satellite = 16
product = "ABI-L2-RRQPEF"
domain = "C"

start = dt.datetime(2024, 1, 1)
end = dt.datetime(2024, 1, 2)

sample_times = [dt.time(0, 0), dt.time(12, 0)]

output = []

# ============================================================
# Extraction loop
# ============================================================
current = start
while current < end:
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
        # ny, nx = a.shape
        # pts_reshape = a.reshape(ny, nx, 3)
        lats = a[:, :, 1]
        lons = a[:, :, 0]

        # mask for positive values
        mask = q > 0.1  # mm/hr threshold
        if not np.any(mask):
            print(f"No rain at {target_dt}")
            continue

        # extract only the rainy pixels
        lat_vals = lats[mask].tolist()
        lon_vals = lons[mask].tolist()
        q_vals = q[mask].tolist()

        entry = {
            "datetime": QPE.t.dt.strftime("%Y-%m-%dT%H:%M:%SZ").item(),
            "points": [
                {"lat": lat_vals[i], "lon": lon_vals[i], "RRQPE": q_vals[i]}
                for i in range(len(q_vals))
            ],
        }

        output.append(entry)
        print(f"Collected {entry['datetime']} ({len(q_vals)} rainy pixels)")

    current += dt.timedelta(days=1)

# ============================================================
# Save JSON
# ============================================================
with open("./lib/RRQPE_2024_12hr_filtered.json", "w") as f:
    json.dump(output, f)

print("Done.")
