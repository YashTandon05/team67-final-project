import s3fs
import xarray as xr
from pathlib import Path
import matplotlib.pyplot as plt
import numpy as np
from pyproj import CRS
import json, os
import rioxarray as rio
from rasterio.enums import Resampling
from datetime import datetime, timedelta
from tqdm import tqdm
import random


# %%
def parse_goes_time(filename: Path):
    time_str = Path(filename).name[:-3].split("_")[-1][1:]
    year = int(time_str[:4])
    jday = int(time_str[4:7])
    hour = int(time_str[7:9])
    minute = int(time_str[9:11])
    second = int(time_str[11:13])
    return datetime(year, 1, 1) + timedelta(
        days=jday - 1, hours=hour, minutes=minute, seconds=second
    )


def get_goes(
    product: str,
    var: str,
    jday: int,
    year: int,
    hour: int,
    coords: list,
    cache_dir="./cache_datasets",
):

    cache_dir = Path(cache_dir) / product / str(year)
    cache_dir.mkdir(parents=True, exist_ok=True)

    fs = s3fs.S3FileSystem(anon=True)

    bucket_prefix = f"s3://noaa-goes16/{product}/{year}/{jday:03d}"
    file_keys = fs.glob(f"{bucket_prefix}/*/*.nc")

    if not file_keys:
        print(f"No files found for {product} on {year}-{jday}.")

    slices = []

    # take 50% of the files
    frac = 0.5
    N = int(len(file_keys) * frac)
    subset = random.sample(file_keys, k=N)

    for s3_path in tqdm(subset):
        local_path = cache_dir / str(jday) / os.path.basename(s3_path)

        # local cache
        if not local_path.exists():
            print(f"Downloading {s3_path} -> {local_path}")
            fs.get(s3_path, str(local_path))

        # open dataset
        ds = xr.open_dataset(local_path, engine="h5netcdf")

        # extract variable of interest
        val = ds[var].where(np.isfinite(ds[var]), drop="False")

        # build GOES projection CRS
        proj_info = ds["goes_imager_projection"].attrs

        goes_crs = CRS.from_proj4(
            f"+proj=geos "
            f"+h={proj_info['perspective_point_height']} "
            f"+lon_0={proj_info['longitude_of_projection_origin']} "
            f"+sweep={proj_info['sweep_angle_axis']} "
            f"+a={proj_info['semi_major_axis']} +b={proj_info['semi_minor_axis']} +units=m"
        )

        # convert goes fixed-grid coords to meeters
        ny, nx = val.shape
        x = ds["x"].values[:nx] * proj_info["perspective_point_height"]
        y = ds["y"].values[:ny] * proj_info["perspective_point_height"]

        # print("val.shape =", val.shape)
        # print("x size =", x.size)
        # print("y size =", y.size)

        # attach correct coords
        val = val.assign_coords({"x": x, "y": y})

        # hand the projection to rioxarray
        val = val.rio.write_crs(goes_crs)
        val = val.rio.set_spatial_dims(x_dim="x", y_dim="y", inplace=False)

        # reproject to lat/lon
        val_reproj = val.rio.reproject(
            "EPSG:4326", resolution=(0.1, 0.1), resampling=Resampling.bilinear
        )

        # clip to coords
        val_clip = val_reproj.rio.clip_box(
            minx=coords[0],
            maxx=coords[1],
            miny=coords[2],
            maxy=coords[3],
        )

        # time stamp
        t = parse_goes_time(local_path)
        val_clip = val_clip.expand_dims(time=[t])

        slices.append(val_clip)

        ds.close()

    ds_day = xr.concat(slices, dim="time")
    return ds_day


# florida
fl_box = [-90, -70, 20, 35]  # lon_min, lon_max, lat_min, lat_max

QPE_day = get_goes(
    product="ABI-L2-RRQPEF",
    var="RRQPE",
    jday=283,  # october 9
    year=2024,
    hour=12,
    coords=fl_box,
)
# %%

QPE_day_mean = QPE_day.mean("time", skipna=True)
QPE_day_mean.plot(x="x", y="y", cmap="viridis")  # now trivial!

# %%
