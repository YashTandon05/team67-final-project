import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";
import * as topojson from "https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/+esm";
import { loadDailyRRQPE } from "./rrqpe_daily.js";
import { preload6hrRRQPE } from "./rrqpe6hr.js";
import { loadDMWData } from "./dmw_data.js";

// globals to track
let rrqpeData = null;
let dmwData = null;
let rrqpeHelene = null;
let currentFeature = "rainfall"; // 'rainfall' or 'wind'
let currDateTime = null;
let currFrameidx = 0;

// globe rendering variables
let svg, canvas, ctx, projection, path, graticule, landGroup, globeContainer;
let width, height;
let rrqpeMax, rrqpeMin;
let dmwMax, dmwMin;
let n6hrFrames;

// interaction state variables
let currentScale;
let minScale;
let maxScale;

let isDragging = false;
let inertiaRotationSpeed = 0;

let lastDragTime = null;
let lastDragX = null;
let lastTime = Date.now();

// NEW: Interaction States & Data
let interactionMode = "none"; // 'none', 'guess-intensity', 'guess-track', 'guess-regions'
let floridaMeanData = []; // [{date, value}, ...]
let trackPrediction = null; // {lon, lat}
let regionPrediction = null; // regionId
let isGlobeInteractionEnabled = true; // New flag

let regions = [
  { id: "A", name: "Panhandle", center: [-85.5, 30.5], radius: 150 },
  { id: "B", name: "Big Bend", center: [-83.5, 29.8], radius: 120 },
  { id: "C", name: "Central FL", center: [-82.0, 28.5], radius: 150 },
  { id: "D", name: "South FL", center: [-80.5, 26.0], radius: 150 },
];

function initGlobe(world) {
  // let CSS control positioning (sticky) for the globe container
  globeContainer = d3.select("#globe-container");
  const rect = globeContainer.node().getBoundingClientRect();

  width = rect.width;
  height = rect.height;

  currentScale = width * 0.2;
  minScale = width * 0.2;
  maxScale = width * 1.5;

  svg = globeContainer
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  canvas = globeContainer
    .append("canvas")
    .attr("width", width)
    .attr("height", height)
    .style("position", "absolute")
    .style("top", "0")
    .style("left", "0")
    .style("pointer-events", "none"); // allow SVG drag/zoom

  ctx = canvas.node().getContext("2d");

  projection = d3
    .geoOrthographic()
    .scale(currentScale)
    .translate([width / 2, height / 2])
    .rotate([80, 0])
    .clipAngle(90);

  path = d3.geoPath(projection);
  graticule = d3.geoGraticule();

  svg
    .append("path")
    .datum({ type: "Sphere" })
    .attr("class", "sphere")
    .attr("d", path);

  svg
    .append("path")
    .datum(graticule())
    .attr("class", "graticule")
    .attr("d", path);

  landGroup = svg.append("g").attr("class", "land-group");
  const land = topojson.feature(world, world.objects.land);
  landGroup
    .selectAll("path")
    .data([land])
    .join("path")
    .attr("class", "land")
    .attr("d", path);

  // track whether the pointer is over the visualization (svg/canvas)
  globeContainer.on("pointerenter", () => (window.__pointerOverViz = true));
  globeContainer.on("pointerleave", () => (window.__pointerOverViz = false));

  // Click handler for interactions
  svg.on("click", handleMapClick);
}

// --- Helper: Auto-Scroll ---
function scrollToStep(stepName) {
  const element = document.querySelector(`.step[data-step="${stepName}"]`);
  if (element) {
    element.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

// --- Interaction 1: Line Graph ---
function initLineGraph() {
  // Florida Bounding Box (Approx)
  // Lat: 24.5 to 31.0
  // Lon: -87.6 to -80.0
  const FL_LAT_MIN = 24.5,
    FL_LAT_MAX = 31.0;
  const FL_LON_MIN = -87.6,
    FL_LON_MAX = -80.0;

  floridaMeanData = rrqpeData
    .filter((d) => {
      const date = new Date(d.datetime);
      return date.getMinutes() === 0 && date.getSeconds() === 0;
    })
    .map((d) => {
      let maxVal = -1;
      for (let i = 0; i < d.lons.length; i++) {
        const lon = d.lons[i];
        const lat = d.lats[i];
        if (
          lat >= FL_LAT_MIN &&
          lat <= FL_LAT_MAX &&
          lon >= FL_LON_MIN &&
          lon <= FL_LON_MAX
        ) {
          maxVal = Math.max(maxVal, d.vals[i]);
        }
      }
      return {
        date: new Date(d.datetime),
        value: maxVal,
      };
    })
    .filter((d) => {
      const date = d.date;
      const startDate = new Date(date.getFullYear(), 8, 21);
      const endDate = new Date(date.getFullYear(), 8, 29, 23, 59, 59);
      return date >= startDate && date <= endDate;
    });

  const container = d3.select("#line-graph-viz");
  container.selectAll("*").remove();

  const margin = { top: 20, right: 20, bottom: 30, left: 40 };
  const width = container.node().clientWidth - margin.left - margin.right;
  const height = container.node().clientHeight - margin.top - margin.bottom;

  const svgGraph = container
    .append("svg")
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom)
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const x = d3
    .scaleTime()
    .domain(d3.extent(floridaMeanData, (d) => d.date))
    .range([0, width]);

  const y = d3
    .scaleLinear()
    .domain([0, d3.max(floridaMeanData, (d) => d.value)])
    .range([height, 0]);

  svgGraph
    .append("g")
    .attr("transform", `translate(0,${height})`)
    .call(d3.axisBottom(x).ticks(5));

  svgGraph.append("g").call(d3.axisLeft(y));

  const line = d3
    .line()
    .x((d) => x(d.date))
    .y((d) => y(d.value));
  const partialData = floridaMeanData.filter((d) => {
    const cutoffDate = new Date(d.date.getFullYear(), 8, 24, 20, 0, 0);
    return d.date <= cutoffDate;
  });

  // console.log(partialData);
  // console.log(floridaMeanData);
  svgGraph
    .append("path")
    .datum(partialData)
    .attr("class", "line-partial")
    .attr("fill", "none")
    .attr("stroke", "#2b9c85")
    .attr("stroke-width", 2)
    .attr("d", line);

  // Interaction overlay
  svgGraph
    .append("rect")
    .attr("width", width)
    .attr("height", height)
    .attr("fill", "transparent")
    .attr("cursor", "pointer")
    .on("click", function (event) {
      if (interactionMode !== "guess-intensity") return;

      const [mx] = d3.pointer(event);
      const guessDate = x.invert(mx);

      // Reveal full line
      svgGraph
        .append("path")
        .datum(floridaMeanData)
        .attr("class", "line-full")
        .attr("fill", "none")
        .attr("stroke", "#2b9c85")
        .attr("stroke-width", 2)
        .attr("stroke-dasharray", "5,5")
        .attr("d", line)
        .attr("opacity", 0)
        .transition()
        .duration(1000)
        .attr("opacity", 1);

      // Mark guess
      svgGraph
        .append("line")
        .attr("x1", mx)
        .attr("x2", mx)
        .attr("y1", 0)
        .attr("y2", height)
        .attr("stroke", "white")
        .attr("stroke-dasharray", "2,2");

      // Show reality text below graph
      d3.select("#reality-text")
        .style("display", "block")
        .style("opacity", 0)
        .transition()
        .delay(1000)
        .duration(500)
        .style("opacity", 1);

      interactionMode = "none";
    });
}

// --- Interaction 2: Track ---

let lastTrackResult = null;
function initTrackInteraction() {
  const currFrame = rrqpeData[currFrameidx];
  const centerCoord = getMaxRainfallCoord(currFrame);
  // Show marker at centerCoord
  svg
    .append("circle")
    .attr("class", "interaction-result true-center")
    .attr("cx", projection(centerCoord)[0])
    .attr("cy", projection(centerCoord)[1])
    .attr("r", 8)
    .attr("fill", "rgba(255, 0, 0, 0.7)")
    .attr("z", 999);

  // draw line between current center and last
  if (lastTrackResult) {
    svg
      .append("line")
      .attr("class", "interaction-result track-line")
      .attr("x1", projection(lastTrackResult)[0])
      .attr("y1", projection(lastTrackResult)[1])
      .attr("x2", projection(centerCoord)[0])
      .attr("y2", projection(centerCoord)[1])
      .attr("stroke", "rgba(255, 0, 0, 0.7)")
      .attr("stroke-width", 2)
      .attr("z", 998);
  }

  // update lastTrackResult
  lastTrackResult = centerCoord;
}

// --- Interaction 3: Regions ---
function drawRegions() {
  // Draw clickable circles for regions
  svg.selectAll(".region-group").remove();

  const g = svg
    .selectAll(".region-group")
    .data(regions)
    .enter()
    .append("g")
    .attr("class", "region-group interaction-result")
    .attr("cursor", "pointer")
    .style("pointer-events", "all") // Ensure clickable
    .on("mouseover", function (event, d) {
      d3.select(this)
        .select(".region-circle")
        .attr("fill", "rgba(43, 156, 133, 0.4)")
        .attr("stroke", "#2b9c85")
        .attr("stroke-width", 2);
    })
    .on("mouseout", function (event, d) {
      d3.select(this)
        .select(".region-circle")
        .attr("fill", "rgba(255, 255, 255, 0.1)")
        .attr("stroke", "rgba(255, 255, 255, 0.5)")
        .attr("stroke-width", 1);
    })
    .on("click", function (event, d) {
      event.stopPropagation();
      if (interactionMode !== "guess-regions") return;

      console.log("Region clicked:", d.id);
      regionPrediction = d.id;
      showFeedback(`You selected: ${d.name}`);

      const actualRegionId = "B";
      drawRegionResult(
        d,
        regions.find((r) => r.id === actualRegionId)
      );
      interactionMode = "none";
      d3.select("#globe-container").classed("cursor-crosshair", false);

      setTimeout(() => {
        scrollToStep("scene12");
      }, 1500);
    });

  g.append("circle")
    .attr("class", "region-circle")
    .attr("cx", (d) => projection(d.center)[0])
    .attr("cy", (d) => projection(d.center)[1])
    .attr("r", 30) // Fixed radius for better clickability
    .attr("fill", "rgba(255, 255, 255, 0.1)")
    .attr("stroke", "rgba(255, 255, 255, 0.5)")
    .style("pointer-events", "all"); // Ensure clickable

  // Add Labels A, B, C, D
  g.append("text")
    .attr("x", (d) => projection(d.center)[0])
    .attr("y", (d) => projection(d.center)[1])
    .attr("dy", "0.35em")
    .attr("text-anchor", "middle")
    .attr("fill", "white")
    .attr("font-weight", "bold")
    .attr("font-size", "16px")
    .style("pointer-events", "none") // Let clicks pass to circle/group
    .text((d) => d.id);
}

function drawRegionResult(userRegion, actualRegion) {
  // Highlight actual
  svg
    .append("circle")
    .attr("class", "interaction-result")
    .attr("cx", projection(actualRegion.center)[0])
    .attr("cy", projection(actualRegion.center)[1])
    .attr("r", 20)
    .attr("fill", "none")
    .attr("stroke", "#00ff00")
    .attr("stroke-width", 3);

  // Show bar chart (Inline)
  const container = d3.select("#bar-chart-viz");
  container.selectAll("*").remove();

  // Simple HTML bars
  const data = [
    { label: "A", val: 30 },
    { label: "B", val: 95 }, // Big Bend
    { label: "C", val: 45 },
    { label: "D", val: 20 },
  ];

  data.forEach((d) => {
    const row = container
      .append("div")
      .style("display", "flex")
      .style("margin", "5px 0")
      .style("align-items", "center");
    row
      .append("div")
      .text(d.label)
      .style("width", "20px")
      .style("margin-right", "10px");
    row
      .append("div")
      .style("width", d.val + "%")
      .style("background", d.label === actualRegion.id ? "#2b9c85" : "#555")
      .style("height", "20px")
      .style("border-radius", "4px");
    row
      .append("div")
      .text(d.val + "%")
      .style("margin-left", "10px")
      .style("font-size", "0.8rem");
  });
}

function clearInteractionResults() {
  svg.selectAll(".interaction-result").remove();
}

function initDragZoom() {
  const drag = d3
    .drag()
    .on("start", (event) => {
      if (!isGlobeInteractionEnabled) return; // Disable interaction
      isDragging = true;
      svg.classed("dragging", true);

      inertiaRotationSpeed = 0;
      lastDragTime = Date.now();
      lastDragX = event.x;
    })
    .on("drag", (event) => {
      if (!isGlobeInteractionEnabled) return; // Disable interaction
      const rotate = projection.rotate();
      const k = 0.1;

      const newLambda = rotate[0] + event.dx * k;
      const newPhi = rotate[1] - event.dy * k;
      projection.rotate([newLambda, newPhi]);
      redraw();

      const now = Date.now();
      const dt = now - lastDragTime || 16;
      const xPixelsMoved = event.x - lastDragX; // we could imrpove this by also using the y coordinate
      const degMoved = xPixelsMoved * k;

      inertiaRotationSpeed = degMoved / dt;
      lastDragTime = now;
      lastDragX = event.x;
    })
    .on("end", () => {
      if (!isGlobeInteractionEnabled) return; // Disable interaction
      isDragging = false;
      svg.classed("dragging", false);

      const maxInertiaSpeed = 0.1;
      if (inertiaRotationSpeed > maxInertiaSpeed)
        inertiaRotationSpeed = maxInertiaSpeed;
      if (inertiaRotationSpeed < -maxInertiaSpeed)
        inertiaRotationSpeed = -maxInertiaSpeed;
    });

  svg.call(drag);

  // Add zoom functionality with mouse wheel
  svg.on("wheel", function (event) {
    if (!isGlobeInteractionEnabled) return; // Disable interaction
    event.preventDefault();

    const delta = event.deltaY;
    const zoomFactor = delta > 0 ? 0.9 : 1.1;

    currentScale *= zoomFactor;
    currentScale = Math.max(minScale, Math.min(maxScale, currentScale));

    projection.scale(currentScale);
    redraw();
  });
}

function animate() {
  lastTime = Date.now();

  d3.timer(() => {
    const now = Date.now();
    const dt = now - lastTime;
    lastTime = now;

    if (!isDragging) {
      const rotate = projection.rotate();
      const newLambda = rotate[0] + inertiaRotationSpeed * dt;
      projection.rotate([newLambda, rotate[1], rotate[2] || 0]);
      redraw();

      const decay = 0.7;
      inertiaRotationSpeed *= decay;
      if (Math.abs(inertiaRotationSpeed) < 0.001) {
        inertiaRotationSpeed = 0;
      }
    }
  });
}

// intialize RRQPE rendering
function renderRRQPEFrame(frame) {
  // Clear canvas to transparent
  ctx.clearRect(0, 0, width, height);

  if (!frame) {
    console.warn("renderRRQPEFrame: frame is null/undefined");
    return;
  }

  const lons = frame.lons;
  const lats = frame.lats;
  const vals = frame.vals;

  const pointSize = 4;
  const rotate = projection.rotate();
  const centerLon = -rotate[0];
  const centerLat = -rotate[1];

  for (let i = 0; i < lons.length; i++) {
    const lon = lons[i];
    const lat = lats[i];
    const v = vals[i];

    // Hemisphere culling: skip if point is on far side of globe
    const dist = d3.geoDistance([lon, lat], [centerLon, centerLat]);
    if (dist > Math.PI / 2) continue; // outside visible hemisphere

    const projected = projection([lon, lat]);
    if (!projected) continue;

    const [x, y] = projected;

    // Canvas bounds check as safety net
    if (x < -10 || x >= width + 10 || y < -10 || y >= height + 10) continue;

    ctx.globalAlpha = 0.9;
    ctx.fillStyle = d3.interpolateTurbo(
      d3.scaleLinear().domain([rrqpeMin, rrqpeMax]).clamp(true)(v)
    );
    ctx.fillRect(x, y, pointSize, pointSize);
  }
}

function renderDMWFrame(frame) {
  ctx.clearRect(0, 0, width, height);

  if (!frame) {
    // console.warn("renderDMWFrame: frame is null/undefined");
    return;
  }

  const lons = frame.lons;
  const lats = frame.lats;
  const vals = frame.vals;
  const us = frame.u;
  const vs = frame.v;

  const rotate = projection.rotate();
  const centerLon = -rotate[0];
  const centerLat = -rotate[1];

  // Arrow styling
  const arrowLength = 15; // Increased from 10
  const arrowHeadSize = 5; // Increased from 3

  for (let i = 0; i < lons.length; i++) {
    const lon = lons[i];
    const lat = lats[i];
    const v = vals[i];
    const uComp = us ? us[i] : 0;
    const vComp = vs ? vs[i] : 0;

    const dist = d3.geoDistance([lon, lat], [centerLon, centerLat]);
    if (dist > Math.PI / 2) continue;

    const projected = projection([lon, lat]);
    if (!projected) continue;

    const [x, y] = projected;

    if (
      x < -arrowLength ||
      x >= width + arrowLength ||
      y < -arrowLength ||
      y >= height + arrowLength
    )
      continue;

    ctx.globalAlpha = 1.0; // Increased opacity
    // Use Plasma for better visibility on dark background (avoids black)
    ctx.fillStyle = d3.interpolatePlasma(
      d3.scaleLinear().domain([dmwMin, dmwMax]).clamp(true)(v)
    );
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = 2.5; // Bolder lines

    // Calculate rotation angle from u, v components
    // Math.atan2(y, x) -> Math.atan2(v, u)
    // Note: In canvas, y increases downwards. In geography/math, v (North) is positive y (up).
    // However, the projection handles the mapping from lat/lon to x/y.
    // We need the angle on the screen.
    // A simple approximation is to assume North is Up (-y on screen) and East is Right (+x on screen).
    // But on a globe, "North" direction changes based on location.
    // For a proper implementation, we should project a second point slightly offset by the wind vector to get the screen angle.

    // Let's project (lon, lat) and (lon + u_delta, lat + v_delta) to get screen angle.
    // Since u, v are in m/s, we need to convert to degrees delta roughly.
    // 1 deg lat ~ 111km. 1 m/s is very small in degrees.
    // Let's just use a small epsilon for direction calculation.

    // Normalize vector
    const mag = Math.sqrt(uComp * uComp + vComp * vComp);
    if (mag === 0) continue;

    // We can't just add u/v to lat/lon directly because u is zonal (East-West) and v is meridional (North-South).
    // u is parallel to latitude circles, v is parallel to longitude lines.
    // Simple approach:
    // Target point in lat/lon space:
    // dLat = v * scaling_factor
    // dLon = u * scaling_factor / cos(lat)

    const scaling = 0.1; // arbitrary small step to determine direction
    const dLat = scaling * vComp;
    const dLon = (scaling * uComp) / Math.cos((lat * Math.PI) / 180);

    const projectedTarget = projection([lon + dLon, lat + dLat]);
    if (!projectedTarget) continue;

    const dx = projectedTarget[0] - x;
    const dy = projectedTarget[1] - y;
    const angle = Math.atan2(dy, dx);

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    // Draw arrow
    ctx.beginPath();
    ctx.moveTo(-arrowLength / 2, 0);
    ctx.lineTo(arrowLength / 2, 0);
    ctx.lineTo(arrowLength / 2 - arrowHeadSize, -arrowHeadSize / 2);
    ctx.moveTo(arrowLength / 2, 0);
    ctx.lineTo(arrowLength / 2 - arrowHeadSize, arrowHeadSize / 2);
    ctx.stroke();

    ctx.restore();
  }
}

function redraw() {
  svg.selectAll(".sphere").attr("d", path);
  svg.selectAll(".graticule").attr("d", path);
  landGroup.selectAll("path.land").attr("d", path);

  if (currentFeature === "rainfall") {
    if (currFrameidx !== null) renderRRQPEFrame(rrqpeData[currFrameidx]);
  } else {
    // Find closest DMW frame
    if (dmwData && dmwData.length > 0) {
      // Simple linear search or just find based on time
      // Since DMW is 3-hourly and RRQPE is 6-hourly/hourly, we need to match times
      // We can find the frame with the smallest time difference
      let closestFrame = null;
      let minDiff = Infinity;

      for (const frame of dmwData) {
        const diff = Math.abs(new Date(frame.datetime) - currDateTime);
        if (diff < minDiff) {
          minDiff = diff;
          closestFrame = frame;
        }
      }

      // Only show if within reasonable threshold (e.g. 1.5 hours)
      if (minDiff < 1.5 * 60 * 60 * 1000) {
        renderDMWFrame(closestFrame);
      } else {
        ctx.clearRect(0, 0, width, height); // Clear if no matching data
      }
    }
  }

  // Re-draw interaction results
  if (interactionMode === "guess-regions") {
    drawRegions();
  }
}

function handleMapClick(event) {
  if (interactionMode === "none") return;

  const [x, y] = d3.pointer(event);
  const coords = projection.invert([x, y]);
  if (!coords) return;

  const [lon, lat] = coords;

  if (interactionMode === "guess-track") {
    trackPrediction = { lon, lat };

    // Calculate actual position (approx 12 hours later)
    const targetIdx = Math.min(currFrameidx + 8, rrqpeData.length - 1);
    const actualCenter = getMaxRainfallCoord(rrqpeData[targetIdx]);

    const distKm = Math.round(d3.geoDistance([lon, lat], actualCenter) * 6371);

    showFeedback(`Prediction placed!`);

    drawTrackResult(trackPrediction, actualCenter);
    interactionMode = "none";
    d3.select("#globe-container").classed("cursor-crosshair", false);

    // Auto-scroll
    setTimeout(() => {
      scrollToStep("scene9");
    }, 1500);
  }
  // Region clicks are now handled by the region group elements directly
}

function getMaxRainfallCoord(frame) {
  if (!frame) return [0, 0];
  let maxVal = -1;
  let maxIdx = -1;
  for (let i = 0; i < frame.vals.length; i++) {
    if (frame.vals[i] > maxVal) {
      maxVal = frame.vals[i];
      maxIdx = i;
    }
  }
  if (maxIdx === -1) return [0, 0];
  return [frame.lons[maxIdx], frame.lats[maxIdx]];
}

function showFeedback(message) {
  const overlay = d3.select("#feedback-message");
  overlay.text(message).classed("visible", true);
  setTimeout(() => {
    overlay.classed("visible", false);
  }, 4000);
}

// ---------- Scrollama Scrollytelling ----------
function initScrollytelling(numFrames) {
  const scroller = scrollama();

  scroller
    .setup({
      step: "#scrolly article .step",
      offset: 0.5,
      debug: false,
    })
    .onStepEnter((response) => {
      // response = { element, index, direction }
      response.element.classList.add("is-active");
      const step = response.element.dataset.step;
      const behavior = response.element.dataset.behavior;

      d3.select("#globe-container").classed("cursor-crosshair", false);
      interactionMode = "none";

      // Scene Logic
      if (step === "scene1") {
        isGlobeInteractionEnabled = true; // Enable for intro
      } else {
        isGlobeInteractionEnabled = false; // Disable for story
      }

      if (step === "scene3" || step === "scene4" || step === "scene5") {
        // Init Line Graph if needed (it's now inline, so always visible in DOM)
        if (floridaMeanData.length === 0) initLineGraph();
      }

      if (
        step !== "scene6" &&
        step !== "scene7" &&
        step !== "scene8" &&
        step !== "scene9"
      ) {
        // Clear previous interaction results
        clearInteractionResults();
        lastTrackResult = null;
      }
      if (step === "scene6") {
        initTrackInteraction();
      }

      if (step === "scene7") {
        // init Track Interaction
        initTrackInteraction();
      }

      if (step === "scene8") {
        initTrackInteraction();
      }

      if (step === "scene9") {
        initTrackInteraction();
      }

      if (behavior === "guess-intensity") {
        interactionMode = "guess-intensity";
      } else if (behavior === "guess-track") {
        interactionMode = "guess-track";
        d3.select("#globe-container").classed("cursor-crosshair", true);
      } else if (behavior === "guess-regions") {
        interactionMode = "guess-regions";
        d3.select("#globe-container").classed("cursor-crosshair", true);
        drawRegions();
      }

      // Camera Movements
      if (step === "scene2" || step === "scene6" || step === "scene10") {
        // button toggle

        d3.select("#controls-container").classed("hidden", false);

        // Zoom to Helene
        const targetScale = width * 1.2;
        const targetRotate = [80, -30.5];
        const targetTranslate = [width / 2, height / 2 - height * 0.15];

        d3.transition()
          .duration(1500)
          .tween("rotate", () => {
            const r = d3.interpolate(projection.rotate(), targetRotate);
            const s = d3.interpolate(projection.scale(), targetScale);
            const tr = d3.interpolate(projection.translate(), targetTranslate);
            return (t) => {
              projection.rotate(r(t));
              projection.scale(s(t));
              projection.translate(tr(t));
              currentScale = s(t);
              redraw();
            };
          });
      } else if (step === "scene1") {
        // Reset
        const targetScale = width * 0.2;
        const targetRotate = [80, 0];
        const targetTranslate = [width / 2, height / 2];

        // button toggle
        d3.select("#controls-container").classed("hidden", true);

        d3.transition()
          .duration(1500)
          .tween("rotate", () => {
            const r = d3.interpolate(projection.rotate(), targetRotate);
            const s = d3.interpolate(projection.scale(), targetScale);
            const tr = d3.interpolate(projection.translate(), targetTranslate);
            return (t) => {
              projection.rotate(r(t));
              projection.scale(s(t));
              projection.translate(tr(t));
              currentScale = s(t);
              redraw();
            };
          });
      }
    })
    .onStepExit((response) => {
      response.element.classList.remove("is-active");
    });

  // Continuous scroll listener for the entire page height
  const onScroll = () => {
    const doc = document.documentElement;
    const scrollTop = doc.scrollTop || document.body.scrollTop || 0;
    const scrollHeight = (doc.scrollHeight || 0) - window.innerHeight;

    if (scrollHeight <= 0) return;

    // Determine the document-space ranges for the early intro steps
    const scene1El = document.querySelector('.step[data-step="scene1"]');
    const spacerEl = document.querySelector('.step[data-step="spacer"]');

    // fall back to full-range mapping if elements are missing
    if (!scene1El || !spacerEl || !n6hrFrames || n6hrFrames <= 1) {
      const t = Math.min(Math.max(scrollTop / scrollHeight, 0), 1);
      const mapped = Math.floor(t * (numFrames - 1));
      if (mapped !== currFrameidx) onFrameChange(mapped);
      return;
    }

    // Use a centering offset similar to the scroller offset (0.5)
    const centerOffset = window.innerHeight * 0.5;

    const rangeStart = Math.max(0, scene1El.offsetTop - centerOffset);
    const rangeEnd = Math.min(
      scrollHeight,
      spacerEl.offsetTop + spacerEl.offsetHeight - centerOffset
    );

    let mapped = 0;

    if (scrollTop < rangeStart) {
      mapped = 0;
    } else if (scrollTop >= rangeStart && scrollTop <= rangeEnd) {
      // Map the progress within the scene1+spacer range to the 6hr frames
      const t = (scrollTop - rangeStart) / Math.max(1, rangeEnd - rangeStart);
      const idx = Math.floor(t * (n6hrFrames - 1));
      mapped = Math.min(Math.max(idx, 0), n6hrFrames - 1);
    } else {
      // Map the remaining scroll to the rest of the frames
      const remainingFrames = Math.max(1, numFrames - n6hrFrames);
      const t = (scrollTop - rangeEnd) / Math.max(1, scrollHeight - rangeEnd);
      const idx = Math.floor(t * (remainingFrames - 1));
      mapped = n6hrFrames + Math.min(Math.max(idx, 0), remainingFrames - 1);
    }

    if (mapped !== currFrameidx) {
      onFrameChange(mapped);
    }
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);

  // Initial call
  onScroll();
}

// legend for color scale
function initColorScale(title, min, max, interpolator) {
  const legendWidth = 20;
  const legendHeight = 300;

  // Clear existing
  d3.select("#color-legend").html("");

  // Container
  const legend = d3
    .select("#color-legend")
    .style("display", "flex")
    .style("flex-direction", "row")
    .style("align-items", "center")
    .style("gap", "8px");

  // Canvas for color ramp
  const canvas = legend
    .append("canvas")
    .attr("width", legendWidth)
    .attr("height", legendHeight)
    .style("border", "1px solid #ccc");

  const ctx = canvas.node().getContext("2d");

  // One mapping scale for ramp position -> actual data value
  const valueScale = d3.scaleLinear().domain([min, max]).range([1, 0]); // top is max, bottom is min

  // Color interpolator
  const colorScale = d3
    .scaleSequential()
    .domain([1, 0])
    .interpolator(interpolator);

  // Draw gradient line by line
  for (let y = 0; y < legendHeight; y++) {
    const t = y / legendHeight; // 0 at top, 1 at bottom
    ctx.fillStyle = colorScale(t);
    ctx.fillRect(0, y, legendWidth, 1);
  }

  // Add labels
  const labelContainer = legend
    .append("div")
    .style("display", "flex")
    .style("flex-direction", "column")
    .style("justify-content", "space-between")
    .style("height", legendHeight + "px");

  labelContainer
    .append("div")
    .style("font-size", "12px")
    .text(`${max.toFixed(1)}`);

  // Add title in the middle (rotated) or side
  // Let's add it to the side for now
  const titleDiv = legend
    .append("div")
    .style("writing-mode", "vertical-rl")
    .style("transform", "rotate(180deg)")
    .style("font-size", "12px")
    .style("font-weight", "bold")
    .style("margin-left", "5px")
    .text(title);

  labelContainer
    .append("div")
    .style("font-size", "12px")
    .text(`${min.toFixed(1)}`);
}

function formatDate(dt) {
  const year = dt.getUTCFullYear();
  const monthName = dt.toLocaleString("en-US", {
    month: "long",
    timeZone: "UTC",
  });
  const day = String(dt.getUTCDate()).padStart(2, "0");
  return `${monthName} ${day}, ${year}`;
}

function onFrameChange(idx) {
  currFrameidx = idx; // Update the global frame index
  const frame = rrqpeData[idx];

  // Update globally-tracked datetime
  currDateTime = new Date(frame.datetime);

  document.getElementById("date").textContent = formatDate(currDateTime);

  document.getElementById("time").textContent = `${String(
    currDateTime.getUTCHours()
  ).padStart(2, "0")}:00`;

  renderRRQPEFrame(frame);
}

async function init() {
  // loading overlay
  const overlay = document.getElementById("loading-overlay");

  // data loading
  const [world, rrqpe6hr, rrqpeHourly, dmwDataRaw] = await Promise.all([
    d3.json(
      "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json"
    ),
    preload6hrRRQPE(),
    loadDailyRRQPE(),
    loadDMWData(),
  ]);

  // Merge datasets
  n6hrFrames = rrqpe6hr.length;
  rrqpeHelene = rrqpeHourly;
  const rrqpe = [...rrqpe6hr, ...rrqpeHourly];

  rrqpeMax = d3.max(rrqpe, (d) => d3.max(d.vals));
  rrqpeMin = d3.min(rrqpe, (d) => d3.min(d.vals));

  // Process DMW data
  if (dmwDataRaw) {
    dmwData = dmwDataRaw;
    dmwMax = d3.max(dmwData, (d) => d3.max(d.vals));
    dmwMin = d3.min(dmwData, (d) => d3.min(d.vals));
  }

  rrqpeData = rrqpe;
  currFrameidx = 0;
  currDateTime = new Date(rrqpeData[0].datetime);

  // globe + canvas init
  initGlobe(world);
  initDragZoom();
  initColorScale(
    "Rainfall Rate (mm/hr)",
    rrqpeMin,
    rrqpeMax,
    d3.interpolateTurbo
  );

  // Toggle Logic
  const toggleBtn = document.getElementById("feature-toggle");
  toggleBtn.addEventListener("click", () => {
    if (currentFeature === "rainfall") {
      currentFeature = "wind";
      toggleBtn.textContent = "Switch to Rainfall";
      initColorScale("Wind Speed (m/s)", dmwMin, dmwMax, d3.interpolateInferno);
    } else {
      currentFeature = "rainfall";
      toggleBtn.textContent = "Switch to Wind Speed";
      initColorScale(
        "Rainfall Rate (mm/hr)",
        rrqpeMin,
        rrqpeMax,
        d3.interpolateTurbo
      );
    }
    redraw();
  });

  // map whole-page scroll position 0..1 to slider frames 0..N-1
  initScrollytelling(rrqpeData.length);

  // Hide loading overlay immediately
  overlay.classList.add("hidden");

  redraw();
  animate();
}

init();
