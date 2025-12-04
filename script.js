import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";
import * as topojson from "https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/+esm";
import { loadDailyRRQPE } from "./rrqpe_daily.js";
import { preload6hrRRQPE } from "./rrqpe6hr.js";

// globals to track
let rrqpeData = null;
let currDateTime = null;
let currFrameidx = 0;

// globe rendering variables
let svg, canvas, ctx, projection, path, graticule, landGroup, globeContainer;
let width, height;
let rrqpeMax, rrqpeMin;

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
  { id: "D", name: "South FL", center: [-80.5, 26.0], radius: 150 }
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
  const FL_LAT_MIN = 24.5, FL_LAT_MAX = 31.0;
  const FL_LON_MIN = -87.6, FL_LON_MAX = -80.0;

  floridaMeanData = rrqpeData.map(d => {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < d.lons.length; i++) {
      const lon = d.lons[i];
      const lat = d.lats[i];
      if (lat >= FL_LAT_MIN && lat <= FL_LAT_MAX && lon >= FL_LON_MIN && lon <= FL_LON_MAX) {
        sum += d.vals[i];
        count++;
      }
    }
    return {
      date: new Date(d.datetime),
      value: count > 0 ? sum / count : 0
    };
  });

  const container = d3.select("#line-graph-viz");
  container.selectAll("*").remove();

  const margin = { top: 20, right: 20, bottom: 30, left: 40 };
  const width = container.node().clientWidth - margin.left - margin.right;
  const height = container.node().clientHeight - margin.top - margin.bottom;

  const svgGraph = container.append("svg")
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom)
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const x = d3.scaleTime()
    .domain(d3.extent(floridaMeanData, d => d.date))
    .range([0, width]);

  const y = d3.scaleLinear()
    .domain([0, d3.max(floridaMeanData, d => d.value)])
    .range([height, 0]);

  svgGraph.append("g")
    .attr("transform", `translate(0,${height})`)
    .call(d3.axisBottom(x).ticks(5));

  svgGraph.append("g")
    .call(d3.axisLeft(y));

  // Initial line (partial)
  const line = d3.line()
    .x(d => x(d.date))
    .y(d => y(d.value));

  // Only show first 20% of data initially
  const partialData = floridaMeanData.slice(0, Math.floor(floridaMeanData.length * 0.2));

  svgGraph.append("path")
    .datum(partialData)
    .attr("class", "line-partial")
    .attr("fill", "none")
    .attr("stroke", "#2b9c85")
    .attr("stroke-width", 2)
    .attr("d", line);

  // Interaction overlay
  svgGraph.append("rect")
    .attr("width", width)
    .attr("height", height)
    .attr("fill", "transparent")
    .attr("cursor", "pointer")
    .on("click", function (event) {
      if (interactionMode !== "guess-intensity") return;

      const [mx] = d3.pointer(event);
      const guessDate = x.invert(mx);

      // Reveal full line
      svgGraph.append("path")
        .datum(floridaMeanData)
        .attr("class", "line-full")
        .attr("fill", "none")
        .attr("stroke", "#2b9c85")
        .attr("stroke-width", 2)
        .attr("stroke-dasharray", "5,5")
        .attr("d", line)
        .attr("opacity", 0)
        .transition().duration(1000).attr("opacity", 1);

      // Mark guess
      svgGraph.append("line")
        .attr("x1", mx).attr("x2", mx)
        .attr("y1", 0).attr("y2", height)
        .attr("stroke", "white")
        .attr("stroke-dasharray", "2,2");

      // Show reality text below graph
      d3.select("#reality-text")
        .style("display", "block")
        .style("opacity", 0)
        .transition().delay(1000).duration(500).style("opacity", 1);

      interactionMode = "none";
    });
}

// --- Interaction 2: Track ---
function getFuturePath(startIndex, numFrames) {
  const path = [];
  for (let i = 0; i < numFrames; i++) {
    const idx = Math.min(startIndex + i, rrqpeData.length - 1);
    const center = getMaxRainfallCoord(rrqpeData[idx]);
    path.push(center);
  }
  return path;
}

function drawExpertCone() {
  // Calculate future path (8 points)
  const futurePath = getFuturePath(currFrameidx, 8);
  const currentCenter = getMaxRainfallCoord(rrqpeData[currFrameidx]);
  const endpoint = futurePath[futurePath.length - 1];

  // Draw 8 spaghetti-style tracks from current to endpoint
  for (let i = 0; i < 8; i++) {
    // Add slight variation to each track
    const offset = (Math.random() - 0.5) * 0.5;
    const trackPath = {
      type: "LineString",
      coordinates: [
        currentCenter,
        [endpoint[0] + offset, endpoint[1] + offset]
      ]
    };

    svg.append("path")
      .datum(trackPath)
      .attr("class", "interaction-result expert-cone")
      .attr("d", path)
      .attr("stroke", "rgba(46, 204, 113, 0.6)") // Green
      .attr("stroke-width", 1.5)
      .attr("fill", "none");
  }

  // Draw green endpoint
  svg.append("circle")
    .attr("class", "interaction-result expert-cone")
    .attr("cx", projection(endpoint)[0])
    .attr("cy", projection(endpoint)[1])
    .attr("r", 6)
    .attr("fill", "#2ecc71")
    .attr("stroke", "white")
    .attr("stroke-width", 2);
}

function drawTrackResult(user, actual) {
  // Draw user's cone (8 spaghetti tracks to their guess)
  const currentCenter = getMaxRainfallCoord(rrqpeData[currFrameidx]);

  for (let i = 0; i < 8; i++) {
    const offset = (Math.random() - 0.5) * 0.5;
    const trackPath = {
      type: "LineString",
      coordinates: [
        currentCenter,
        [user.lon + offset, user.lat + offset]
      ]
    };

    svg.append("path")
      .datum(trackPath)
      .attr("class", "interaction-result")
      .attr("d", path)
      .attr("stroke", "rgba(231, 76, 60, 0.6)") // Red
      .attr("stroke-width", 1.5)
      .attr("fill", "none");
  }

  // Draw red endpoint (user's guess)
  svg.append("circle")
    .attr("class", "interaction-result")
    .attr("cx", projection([user.lon, user.lat])[0])
    .attr("cy", projection([user.lon, user.lat])[1])
    .attr("r", 6)
    .attr("fill", "#e74c3c")
    .attr("stroke", "white")
    .attr("stroke-width", 2);

  // Draw dashed line from user guess to actual
  svg.append("path")
    .datum({ type: "LineString", coordinates: [[user.lon, user.lat], actual] })
    .attr("class", "interaction-result")
    .attr("d", path)
    .attr("stroke", "yellow")
    .attr("stroke-width", 2)
    .attr("stroke-dasharray", "4,4");
}

// --- Interaction 3: Regions ---
function drawRegions() {
  // Draw clickable circles for regions
  svg.selectAll(".region-group").remove();

  const g = svg.selectAll(".region-group")
    .data(regions)
    .enter()
    .append("g")
    .attr("class", "region-group interaction-result")
    .attr("cursor", "pointer")
    .style("pointer-events", "all") // Ensure clickable
    .on("mouseover", function (event, d) {
      d3.select(this).select(".region-circle")
        .attr("fill", "rgba(43, 156, 133, 0.4)")
        .attr("stroke", "#2b9c85")
        .attr("stroke-width", 2);
    })
    .on("mouseout", function (event, d) {
      d3.select(this).select(".region-circle")
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
      drawRegionResult(d, regions.find(r => r.id === actualRegionId));
      interactionMode = "none";
      d3.select("#globe-container").classed("cursor-crosshair", false);

      setTimeout(() => {
        scrollToStep("scene12");
      }, 1500);
    });

  g.append("circle")
    .attr("class", "region-circle")
    .attr("cx", d => projection(d.center)[0])
    .attr("cy", d => projection(d.center)[1])
    .attr("r", 30) // Fixed radius for better clickability
    .attr("fill", "rgba(255, 255, 255, 0.1)")
    .attr("stroke", "rgba(255, 255, 255, 0.5)")
    .style("pointer-events", "all"); // Ensure clickable

  // Add Labels A, B, C, D
  g.append("text")
    .attr("x", d => projection(d.center)[0])
    .attr("y", d => projection(d.center)[1])
    .attr("dy", "0.35em")
    .attr("text-anchor", "middle")
    .attr("fill", "white")
    .attr("font-weight", "bold")
    .attr("font-size", "16px")
    .style("pointer-events", "none") // Let clicks pass to circle/group
    .text(d => d.id);
}

function drawRegionResult(userRegion, actualRegion) {
  // Highlight actual
  svg.append("circle")
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
    { label: "D", val: 20 }
  ];

  data.forEach(d => {
    const row = container.append("div").style("display", "flex").style("margin", "5px 0").style("align-items", "center");
    row.append("div").text(d.label).style("width", "20px").style("margin-right", "10px");
    row.append("div")
      .style("width", d.val + "%")
      .style("background", d.label === actualRegion.id ? "#2b9c85" : "#555")
      .style("height", "20px")
      .style("border-radius", "4px");
    row.append("div").text(d.val + "%").style("margin-left", "10px").style("font-size", "0.8rem");
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

  const pointSize = 2;
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

function redraw() {
  svg.selectAll(".sphere").attr("d", path);
  svg.selectAll(".graticule").attr("d", path);
  landGroup.selectAll("path.land").attr("d", path);
  if (currFrameidx !== null) renderRRQPEFrame(rrqpeData[currFrameidx]);

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

      // Reset interactions
      // Clear expert cone if not in track section (Scene 7, 8, 9)
      if (step !== "scene7" && step !== "scene8" && step !== "scene9") {
        svg.selectAll(".expert-cone").remove();
      }

      // Clear other results if not in reveal steps
      if (step !== "scene8" && step !== "scene9" && step !== "scene12") {
        svg.selectAll(".interaction-result:not(.expert-cone)").remove();
      }

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

      if (step === "scene7") {
        drawExpertCone();
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
        // Zoom to Helene
        const targetScale = width * 1;
        const targetRotate = [82.5, -27.5];
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

    // Map scroll percentage to frame index

    const t = Math.min(Math.max(scrollTop / scrollHeight, 0), 1);
    const mapped = Math.floor(t * (numFrames - 1));

    if (mapped !== currFrameidx) {
      onFrameChange(mapped);
    }
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);

  // Initial call
  onScroll();
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
  const [world, rrqpe6hr, rrqpeHourly] = await Promise.all([
    d3.json(
      "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json"
    ),
    preload6hrRRQPE(),
    loadDailyRRQPE(),
  ]);

  // Merge datasets
  const rrqpe = [...rrqpe6hr, ...rrqpeHourly].sort(
    (a, b) => a.datetime - b.datetime
  );

  rrqpeMax = d3.max(rrqpe, (d) => d3.max(d.vals));
  rrqpeMin = d3.min(rrqpe, (d) => d3.min(d.vals));

  rrqpeData = rrqpe;
  currFrameidx = 0;
  currDateTime = new Date(rrqpeData[0].datetime);

  // globe + canvas init
  initGlobe(world);
  initDragZoom();

  // map whole-page scroll position 0..1 to slider frames 0..N-1
  initScrollytelling(rrqpeData.length);

  // Hide loading overlay immediately
  overlay.classList.add("hidden");

  redraw();
  animate();
}

init();
