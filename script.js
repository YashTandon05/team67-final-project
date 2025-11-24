import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";
import * as topojson from "https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/+esm";
import { preload12hRRQPE, times12Hr } from "./rrqpe12hr.js";

// globals
const width = 700;
const height = 700;
let rrqpeData12h;
let currDateTime;
let currFrameIndex = 0;

const svg = d3
  .select("#globe-container")
  .append("svg")
  .attr("viewBox", `0 0 ${width} ${height}`)
  .attr("preserveAspectRatio", "xMidYMid meet");

let currentScale = width * 0.45;
const minScale = width * 0.2;
const maxScale = width * 1.5;

const projection = d3
  .geoOrthographic()
  .scale(currentScale)
  .translate([width / 2, height / 2])
  .clipAngle(90);
const path = d3.geoPath(projection);
const graticule = d3.geoGraticule();

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

const landGroup = svg.append("g").attr("class", "land-group");
let isDragging = false;
let inertiaRotationSpeed = 0;

let lastDragTime = null;
let lastDragX = null;
let lastTime = Date.now();

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

d3.json("https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json")
  .then((world) => {
    const land = topojson.feature(world, world.objects.land);

    landGroup
      .selectAll("path")
      .data([land])
      .join("path")
      .attr("class", "land")
      .attr("d", path);

    animate();
  })
  .catch((error) => console.error("Map load error:", error));

function redraw() {
  svg.selectAll(".sphere").attr("d", path);
  svg.selectAll(".graticule").attr("d", path);
  landGroup.selectAll("path.land").attr("d", path);
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

// Initialize RRQPE visualization

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
  currFrameIndex = idx;

  const frame = rrqpeData12h[idx];

  // Update globally-tracked datetime
  currDateTime = new Date(frame.datetime);
  document.getElementById("time-slider").value = idx;

  document.getElementById("current-date").textContent =
    formatDate(currDateTime);

  document.getElementById("current-time").textContent = `${String(
    currDateTime.getUTCHours()
  ).padStart(2, "0")}:00`;
}

async function init() {
  rrqpeData12h = await preload12hRRQPE();

  const overlay = document.getElementById("loading-overlay");
  overlay.classList.add("hidden");

  // Initialize the global timestamp
  currFrameIndex = 0;
  currDateTime = new Date(rrqpeData12h[0].datetime);

  // Build the slider with the correct range
  initTimeSlider(rrqpeData12h.length);

  // Initial render
  onFrameChange(0);
}

init();
