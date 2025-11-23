from goes2go import goes_nearesttime
from goes2go.tools import abi_crs, lat_lon_to_scan_angles
from toolbox.cartopy_tools_OLD import common_features
import cartopy.crs as ccrs
import matplotlib.pyplot as plt
import numpy as np
import datetime as dt

# before doing this make sure to install the provided conda environment and set your goes2go configuration file (mine was in ~/.config/goes2go)
satellite = 16  # for GOES-16 (East)
QPE_product_code = "ABI-L2-RRQPEF"
domain = "C"
date = "2024-01-01"

QPE = goes_nearesttime(date, product=QPE_product_code, domain=domain)
crs, x, y = abi_crs(QPE, "RRQPE")
proj = QPE["goes_imager_projection"]

plt.figure()
ax = common_features("50m", crs=crs, figsize=[10, 8], dark=True)
c = ax.pcolormesh(x, y, QPE.RRQPE, transform=crs, cmap="gnuplot2", vmin=0)
plt.colorbar(
    c,
    ax=ax,
    shrink=0.8,
    pad=0.01,
    orientation="horizontal",
    label=f"{QPE.RRQPE.long_name}\n({QPE.RRQPE.units})",
)
ax.set_title(f"{QPE.t.dt.strftime('%H:%M UTC %d %b %Y').item()}")
plt.show()

lon_min, lon_max = -140, -65
lat_min, lat_max = 20, 55

plt.figure()
ax = common_features("50m", crs=crs, figsize=[10, 8], dark=True)
ax.set_extent([lon_min, lon_max, lat_min, lat_max], crs=ccrs.PlateCarree())
c = ax.pcolormesh(x, y, QPE.RRQPE, transform=crs, cmap="gnuplot2", vmin=0)
plt.colorbar(
    c,
    ax=ax,
    shrink=0.8,
    pad=0.01,
    orientation="horizontal",
    label=f"{QPE.RRQPE.long_name}\n({QPE.RRQPE.units})",
)
ax.set_title(f"{QPE.t.dt.strftime('%H:%M UTC %d %b %Y').item()}")

ax.set_title("RRQPE, focused on scan window")
plt.show()

TPW_product_code = "ABI-L2-TPW"
date = dt.datetime(2024, 10, 9, 0)
TPW = goes_nearesttime(
    satellite=satellite, attime=date, product=TPW_product_code, domain=domain
)
crs, x, y = abi_crs(TPW, "TPW")
plt.figure()
ax = common_features("50m", crs=crs, figsize=[10, 8], dark=True)
c = ax.pcolormesh(x, y, TPW.TPW, transform=crs, cmap="gnuplot2", vmin=0)
plt.colorbar(
    c,
    ax=ax,
    shrink=0.8,
    pad=0.01,
    orientation="horizontal",
    label=f"{TPW.TPW.long_name}\n({TPW.TPW.units})",
)

ax.set_title(f"{TPW.t.dt.strftime('%H:%M UTC %d %b %Y').item()}")
ax.set_extent([lon_min, lon_max, lat_min, lat_max], crs=ccrs.PlateCarree())
plt.show()
