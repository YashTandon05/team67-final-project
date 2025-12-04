import xarray as xr
from pathlib import Path
import matplotlib.pyplot as plt
import numpy as np
from pyproj import CRS
import json
from datetime import datetime, timedelta
from goes2go import GOES
from goes2go.tools import abi_crs

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

coords = [-95, -70, 15, 40]
downsample_factor = 4  # Take every Nth point (4 = 1/16th of data, 8 = 1/64th, etc.)
filter_zeros = True  # For RRQPE: filter out zero rainfall values to reduce file size
reduce_precision = True  # Round lat/lon to 4 decimals, values to 2 decimals

def get_goes(
    product: str,
    var: str,
    month: int,
    day: int,
    year: int,
    hour: int,
    coords: list,
    cache_dir="./cache_datasets",
    local_data_dir=r"C:\Users\yasht\data\noaa-goes18",
):
    slices = []

    # Convert calendar date to julian day
    date_obj = datetime(year, month, day)
    julian_day = date_obj.timetuple().tm_yday
    
    product_dir = product + "F"
    # Check for local files first
    local_dir = Path(local_data_dir) / product_dir / str(year) / str(julian_day) / f"{hour:02d}"
    local_nc_files = list(local_dir.glob("*.nc")) if local_dir.exists() else []
    
    if local_nc_files:
        # Use the first .nc file found
        local_path = local_nc_files[0]
        print(f"Using local file: {local_path}")
        ds = xr.open_dataset(local_path, engine="h5netcdf")
    else:
        # Fall back to GOES API
        print(f"No local file found, using GOES API for {year}-{month:02d}-{day:02d} {hour:02d}:00")
        cache_dir = Path(cache_dir) / product / str(year)
        cache_dir.mkdir(parents=True, exist_ok=True)
        
        G = GOES(satellite=18, product=product, domain='F')
        ds = G.nearesttime(f'{year}-{month:02d}-{day:02d} {hour:02d}:00')

    # extract variable of interest
    val = ds[var].where(np.isfinite(ds[var]), drop="False")
    
    # Return both the data array and the dataset (dataset needed for coordinate lookup)
    return val, ds


output_dir = Path("./lib")
output_dir.mkdir(parents=True, exist_ok=True)

# Collect all datasets
all_datasets = []
hourly_means_over_time = []

for day in range(23, 29):
    day_hour_entries = []
    
    for hour in range(0, 24):
        try:
            val, ds = get_goes(product="ABI-L2-RRQPE", var="RRQPE", month=9, day=day, year=2024, hour=hour, coords=coords)
            
            var_name = "RRQPE"
            
            # Get the actual 2D data array (not scalar)
            # Check if val has spatial dimensions
            if len(val.dims) == 0 or val.size == 1:
                # If scalar, get the full variable from dataset
                val = ds[var_name]
            
            # Ensure we have 2D data - check dimensions
            if 'y' in val.dims and 'x' in val.dims:
                # Select first time slice if time dimension exists
                if 't' in val.dims:
                    val = val.isel(t=0)
                values_2d = val.values
                val_shape = values_2d.shape
            else:
                raise ValueError(f"Expected 2D data with y/x dimensions, got dims: {val.dims}, shape: {val.shape}")
            
            # Try to get lat/lon coordinates directly from dataset first
            if "latitude" in ds.coords and "longitude" in ds.coords:
                lat_data = ds.coords["latitude"]
                lon_data = ds.coords["longitude"]
                # Check if they're 2D or need to be meshed
                if len(lat_data.shape) == 2 and len(lon_data.shape) == 2:
                    lats_2d = lat_data.values
                    lons_2d = lon_data.values
                elif len(lat_data.shape) == 1 and len(lon_data.shape) == 1:
                    # Create meshgrid
                    lons_2d, lats_2d = np.meshgrid(lon_data.values, lat_data.values, indexing='xy')
                else:
                    # Fall back to abi_crs conversion
                    raise ValueError("Unexpected lat/lon coordinate shapes")
            else:
                # Convert from projection coordinates using abi_crs
                crs, x_proj, y_proj = abi_crs(ds, var_name)
                
                # x_proj and y_proj are 1D arrays, need to create 2D meshgrid
                if len(x_proj.shape) == 1 and len(y_proj.shape) == 1:
                    X, Y = np.meshgrid(x_proj, y_proj, indexing='xy')
                else:
                    X, Y = x_proj, y_proj
                
                # Convert from projection coordinates to lat/lon using the CRS
                from pyproj import Transformer
                transformer = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
                lons_2d, lats_2d = transformer.transform(X, Y)
            
            # Ensure shapes match
            if lats_2d.shape != val_shape or lons_2d.shape != val_shape:
                # Trim coordinates if they're larger
                if lats_2d.shape[0] >= val_shape[0] and lats_2d.shape[1] >= val_shape[1]:
                    lats_2d = lats_2d[:val_shape[0], :val_shape[1]]
                    lons_2d = lons_2d[:val_shape[0], :val_shape[1]]
                else:
                    raise ValueError(f"Coordinate shape mismatch: lats={lats_2d.shape}, lons={lons_2d.shape}, data={val_shape}")

            # Aggregate blocks into single values (e.g., 4x4 blocks → 1 value)
            if downsample_factor > 1:
                h, w = values_2d.shape
                # Trim to multiples of downsample_factor
                h_trim = (h // downsample_factor) * downsample_factor
                w_trim = (w // downsample_factor) * downsample_factor
                
                # Trim arrays
                values_2d = values_2d[:h_trim, :w_trim]
                lats_2d = lats_2d[:h_trim, :w_trim]
                lons_2d = lons_2d[:h_trim, :w_trim]
                
                # Reshape into blocks and aggregate
                # For values: take mean of each block
                values_reshaped = values_2d.reshape(
                    h_trim // downsample_factor, downsample_factor,
                    w_trim // downsample_factor, downsample_factor
                )
                # Use nanmean with where to avoid warnings on empty slices
                with np.errstate(invalid='ignore'):
                    values_2d = np.nanmean(values_reshaped, axis=(1, 3))
                
                # For coordinates: take mean (center) of each block
                lats_reshaped = lats_2d.reshape(
                    h_trim // downsample_factor, downsample_factor,
                    w_trim // downsample_factor, downsample_factor
                )
                with np.errstate(invalid='ignore'):
                    lats_2d = np.nanmean(lats_reshaped, axis=(1, 3))
                
                lons_reshaped = lons_2d.reshape(
                    h_trim // downsample_factor, downsample_factor,
                    w_trim // downsample_factor, downsample_factor
                )
                with np.errstate(invalid='ignore'):
                    lons_2d = np.nanmean(lons_reshaped, axis=(1, 3))

            # Filter out invalid values (flatten arrays for indexing)
            valid_mask = np.isfinite(values_2d)
            lats_flat = lats_2d.flatten()
            lons_flat = lons_2d.flatten()
            values_flat = values_2d.flatten()
            
            # Apply mask for valid values
            lats = lats_flat[valid_mask.flatten()]
            lons = lons_flat[valid_mask.flatten()]
            values = values_flat[valid_mask.flatten()]
            
            # Filter points within bounding box
            min_lon, max_lon, min_lat, max_lat = coords[0], coords[1], coords[2], coords[3]
            bbox_mask = (
                (lons >= min_lon) & (lons <= max_lon) &
                (lats >= min_lat) & (lats <= max_lat)
            )
            lats = lats[bbox_mask]
            lons = lons[bbox_mask]
            values = values[bbox_mask]
            
            # Filter out zero values if requested (useful for rainfall data)
            if filter_zeros:
                non_zero_mask = values > 0
                lats = lats[non_zero_mask]
                lons = lons[non_zero_mask]
                values = values[non_zero_mask]
            
            # Convert to JSON format with optional precision reduction
            data_list = []
            for i in range(len(lats)):
                if reduce_precision:
                    # Round to reduce file size: lat/lon to 4 decimals (~11m precision), values to 2 decimals
                    data_list.append({
                        "lat": round(float(lats[i]), 4),
                        "lon": round(float(lons[i]), 4),
                        var_name: round(float(values[i]), 2)
                    })
                else:
                    data_list.append({
                        "lat": float(lats[i]),
                        "lon": float(lons[i]),
                        var_name: float(values[i])
                    })
            
            # Calculate mean value
            if len(values) > 0:
                hourly_mean_value = float(np.nanmean(values))
            else:
                hourly_mean_value = np.nan
                print(f"Warning: No valid points found for day {day}, hour {hour}")
            
            # Store for per-day JSON
            day_hour_entries.append({
                "hour": hour,
                "mean_value": hourly_mean_value,
                "variable": var_name,
                "product": "ABI-L2-RRQPE",
                "data": data_list,
                "num_points": len(data_list)
            })
            
            print(f"Processed day {day}, hour {hour}: {len(data_list)} points with mean {hourly_mean_value}")
            
            # Close dataset
            ds.close()
            
        except Exception as e:
            print(f"Error processing day {day}, hour {hour}: {e}")
            import traceback
            traceback.print_exc()
            continue
    
    # Save per-day JSON
    if day_hour_entries:
        out_file = output_dir / f"2024_09_{day:02d}_hourly_RRQPE.json"
        with open(out_file, "w") as f:
            json.dump({
                "date": f"2024-09-{day:02d}",
                "product": "ABI-L2-RRQPE",
                "hours": day_hour_entries
            }, f, indent=2)

print("Processing complete.")