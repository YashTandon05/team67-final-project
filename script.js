import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";
import * as topojson from "https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/+esm";
import { preload12hRRQPE, times12Hr } from "./rrqpe12hr.js";

// globals to track
let rrqpeData12h = null;
let currDateTime = null;
let currFrame = null;
let currFrameidx = 0;

let svg, canvas, ctx, projection, path, graticule, landGroup, globeContainer;
let width, height;

let currentScale;
let minScale;
let maxScale;

let isDragging = false;
let inertiaRotationSpeed = 0;

let lastDragTime = null;
let lastDragX = null;
let lastTime = Date.now();

function initGlobe(world) {
  globeContainer = d3.select("#globe-container").style("position", "relative");
  const rect = globeContainer.node().getBoundingClientRect();

  width = rect.width;
  height = rect.height;

  // Now that width/height are defined, compute scale and bounds
  currentScale = width * 0.45;
  minScale = width * 0.2;
  maxScale = width * 1.5;

  svg = globeContainer
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .style("width", "100%")
    .style("height", "100%")
    .style("display", "block")
    .style("position", "absolute")
    .style("top", "0")
    .style("left", "0");

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
}

function initDragZoom() {
  const drag = d3
    .drag()
    .on("start", (event) => {
      isDragging = true;
      svg.classed("dragging", true);

      inertiaRotationSpeed = 0;
      lastDragTime = Date.now();
      lastDragX = event.x;
    })
    .on("drag", (event) => {
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

      const decay = 0.94;
      inertiaRotationSpeed *= decay;
      if (Math.abs(inertiaRotationSpeed) < 0.00001) {
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
    ctx.fillStyle = d3.interpolateTurbo(Math.min(1, Math.max(0, (v - 1) / 99)));
    ctx.fillRect(x, y, pointSize, pointSize);
  }
}

function redraw() {
  svg.selectAll(".sphere").attr("d", path);
  svg.selectAll(".graticule").attr("d", path);
  landGroup.selectAll("path.land").attr("d", path);
  if (currFrameidx !== null) renderRRQPEFrame(rrqpeData12h[currFrameidx]);
}

// slider and scroller functionality
function initTimeSlider(numFrames) {
  const slider = document.getElementById("time-slider");

  // slider should map (-) frames
  slider.min = 0;
  slider.max = numFrames - 1;
  slider.step = 1;
  slider.value = 0;

  slider.addEventListener("input", (e) => {
    const idx = Number(e.target.value);
    onFrameChange(idx);
  });
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
  console.log("Frame index changed to:", idx);
  const frame = rrqpeData12h[idx];

  // Update globally-tracked datetime
  currDateTime = new Date(frame.datetime);
  document.getElementById("time-slider").value = idx;

  document.getElementById("current-date").textContent =
    formatDate(currDateTime);

  document.getElementById("current-time").textContent = `${String(
    currDateTime.getUTCHours()
  ).padStart(2, "0")}:00`;

  renderRRQPEFrame(frame);
}

async function init() {
  const overlay = document.getElementById("loading-overlay");

  const [world, rrqpe] = await Promise.all([
    d3.json(
      "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json"
    ),
    preload12hRRQPE(),
  ]);

  rrqpeData12h = rrqpe;
  currFrameidx = 0;
  currFrame = rrqpeData12h[currFrameidx];
  currDateTime = new Date(rrqpeData12h[0].datetime);

  initGlobe(world);
  initDragZoom();
  initTimeSlider(rrqpeData12h.length);

  // Hide loading overlay immediately
  overlay.classList.add("hidden");

  redraw();
  animate();
}

init();
