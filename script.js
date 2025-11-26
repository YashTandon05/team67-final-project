import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";
import * as topojson from "https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/+esm";
import { loadDailyRRQPE } from "./rrqpe_daily.js";
import { preload12hRRQPE } from "./rrqpe12hr.js";

// globals to track
let rrqpeData12h = null;
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
    .translate([width / 2, height / 2]).rotate([80, 0])
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
    onFrameChange(idx, "slider");
  });
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
      if (step === "helene" || step === "transition") {
        // Zoom to Helene: [-95, -70, 15, 40]
        // Center approx [-82.5, 27.5]
        // Rotation should be opposite of center: [82.5, -27.5]
        const targetScale = width * 1; // Zoom in 3x (user adjusted to 1x)
        const targetRotate = [82.5, -27.5];
        // Pan up by 15% of height to avoid time slider
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
              // Update currentScale to keep track for drag/zoom
              currentScale = s(t);
              redraw();
            };
          });
      } else {
        // Reset to default view
        const targetScale = width * 0.2; // Updated to match user change (0.2)
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

  // Continuous scroll listener for the entire page height mapped to slider
  // We want the slider to move as we scroll through the scrolly section
  const onScroll = () => {
    const doc = document.documentElement;
    const scrollTop = doc.scrollTop || document.body.scrollTop || 0;
    const scrollHeight = (doc.scrollHeight || 0) - window.innerHeight;

    if (scrollHeight <= 0) return;

    // Map scroll percentage to frame index
    const t = Math.min(Math.max(scrollTop / scrollHeight, 0), 1);
    const mapped = Math.floor(t * (numFrames - 1));

    if (mapped !== currFrameidx) {
      onFrameChange(mapped, "scroll");
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

function onFrameChange(idx, source = "unknown") {
  currFrameidx = idx; // Update the global frame index
  // console.log("Frame index changed to:", idx, "Source:", source);
  const frame = rrqpeData12h[idx];

  // Update globally-tracked datetime
  currDateTime = new Date(frame.datetime);

  // Update slider if not the source
  const slider = document.getElementById("time-slider");
  if (slider.value != idx) {
    slider.value = idx;
  }

  // Update scroll if not the source
  if (source !== "scroll") {
    const doc = document.documentElement;
    const scrollHeight = (doc.scrollHeight || 0) - window.innerHeight;
    if (scrollHeight > 0) {
      const t = idx / (rrqpeData12h.length - 1);
      const targetScrollTop = t * scrollHeight;
      // Avoid jitter by checking difference? Or just set it.
      // Setting it might trigger onScroll, but onScroll checks if mapped !== currFrameidx
      // If it's the same, onScroll won't call onFrameChange.
      window.scrollTo(0, targetScrollTop);
    }
  }

  document.getElementById("current-date").textContent =
    formatDate(currDateTime);

  document.getElementById("current-time").textContent = `${String(
    currDateTime.getUTCHours()
  ).padStart(2, "0")}:00`;

  renderRRQPEFrame(frame);
}

async function init() {
  // loading overlay
  const overlay = document.getElementById("loading-overlay");

  // data loading
  const [world, rrqpeJan, rrqpeSept] = await Promise.all([
    d3.json(
      "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json"
    ),
    preload12hRRQPE(),
    loadDailyRRQPE(),
  ]);

  // Merge datasets
  const rrqpe = [...rrqpeJan, ...rrqpeSept].sort(
    (a, b) => a.datetime - b.datetime
  );

  rrqpeMax = d3.max(rrqpe, (d) => d3.max(d.vals));
  rrqpeMin = d3.min(rrqpe, (d) => d3.min(d.vals));

  rrqpeData12h = rrqpe;
  currFrameidx = 0;
  currDateTime = new Date(rrqpeData12h[0].datetime);

  // globe + canvas init
  initGlobe(world);
  initDragZoom();

  // slider
  initTimeSlider(rrqpeData12h.length);

  // map whole-page scroll position 0..1 to slider frames 0..N-1
  initScrollytelling(rrqpeData12h.length);

  // Hide loading overlay immediately
  overlay.classList.add("hidden");

  // initial render
  redraw();
  animate();
}

init();
