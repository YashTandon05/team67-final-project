import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";
import * as topojson from "https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/+esm";
import { loadDailyRRQPE } from "./rrqpe_daily.js";
import { preload6hrRRQPE } from "./rrqpe6hr.js";
import { loadDMWData } from "./dmw_data.js";

let rrqpeData = null;
let dmwData = null;
let rrqpeHelene = null;
let currentFeature = "rainfall"; // 'rainfall' or 'wind'
let currDateTime = null;
let currFrameidx = 0;

let baseSvg,
  svg,
  canvas,
  ctx,
  projection,
  path,
  graticule,
  landGroup,
  globeContainer;
let width, height;
let rrqpeMax, rrqpeMin;
let dmwMax, dmwMin;
let n6hrFrames;

let currentScale;
let minScale;
let maxScale;

let scrollDirection = 0;

let isDragging = false;
let inertiaRotationSpeed = 0;

let lastDragTime = null;
let lastDragX = null;
let lastTime = Date.now();

let interactionMode = "none"; // 'none', 'guess-intensity', 'guess-track'
let floridaMeanData = [];
let isGlobeInteractionEnabled = true;

function initGlobe(world) {
  globeContainer = d3.select("#globe-container");
  const rect = globeContainer.node().getBoundingClientRect();

  width = rect.width;
  height = rect.height;
  currentScale = width * 0.2;
  minScale = width * 0.2;
  maxScale = width * 1.5;

  baseSvg = globeContainer
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .style("position", "absolute")
    .style("top", "0")
    .style("left", "0")
    .style("z-index", 1);

  canvas = globeContainer
    .append("canvas")
    .attr("width", width)
    .attr("height", height)
    .style("position", "absolute")
    .style("top", "0")
    .style("left", "0")
    .style("pointer-events", "none")
    .style("z-index", 2);

  ctx = canvas.node().getContext("2d");

  svg = globeContainer
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .style("position", "absolute")
    .style("top", "0")
    .style("left", "0")
    .style("z-index", 3);

  projection = d3
    .geoOrthographic()
    .scale(currentScale)
    .translate([width / 2, height / 2])
    .rotate([80, 0])
    .clipAngle(90);

  path = d3.geoPath(projection);
  graticule = d3.geoGraticule();

  baseSvg
    .append("path")
    .datum({ type: "Sphere" })
    .attr("class", "sphere")
    .attr("d", path);

  baseSvg
    .append("path")
    .datum(graticule())
    .attr("class", "graticule")
    .attr("d", path);

  landGroup = baseSvg.append("g").attr("class", "land-group");
  const land = topojson.feature(world, world.objects.land);
  landGroup
    .selectAll("path")
    .data([land])
    .join("path")
    .attr("class", "land")
    .attr("d", path);

  globeContainer.on("pointerenter", () => (window.__pointerOverViz = true));
  globeContainer.on("pointerleave", () => (window.__pointerOverViz = false));

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
    .style("pointer-events", "all")
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
  svgGraph
    .append("line")
    .attr("x1", 0)
    .attr("x2", width)
    .attr("y1", y(50))
    .attr("y2", y(50))
    .attr("stroke", "red")
    .attr("stroke-dasharray", "4");

  svgGraph
    .append("text")
    .attr("text-anchor", "end")
    .attr("x", width)
    .attr("y", height + margin.top + 10)
    .text("Date")
    .attr("fill", "white")
    .attr("font-size", "15px");

  svgGraph
    .append("text")
    .attr("text-anchor", "end")
    .attr("transform", "rotate(-90)")
    .attr("y", -margin.left + 15)
    .attr("x", -margin.top)
    .text("Max Rainfall (mm/hr)")
    .attr("fill", "white")
    .attr("font-size", "15px");

  const line = d3
    .line()
    .x((d) => x(d.date))
    .y((d) => y(d.value));
  const partialData = floridaMeanData.filter((d) => {
    const cutoffDate = new Date(d.date.getFullYear(), 8, 24, 20, 0, 0);
    return d.date <= cutoffDate;
  });

  svgGraph
    .append("path")
    .datum(partialData)
    .attr("class", "line-partial")
    .attr("fill", "none")
    .attr("stroke", "#2b9c85")
    .attr("stroke-width", 2)
    .attr("d", line);

  const rulerLine = svgGraph.append("line")
    .attr("class", "ruler-line")
    .attr("y1", 0).attr("y2", height)
    .attr("stroke", "rgba(255, 255, 255, 0.5)")
    .attr("stroke-dasharray", "3,3")
    .style("opacity", 0).style("pointer-events", "none");

  const rulerText = svgGraph.append("text")
    .attr("class", "ruler-text")
    .attr("y", -5).attr("fill", "white").attr("font-size", "12px")
    .style("opacity", 0).style("pointer-events", "none");

  svgGraph.append("rect")
    .attr("class", "overlay")
    .attr("width", width)
    .attr("height", height)
    .style("fill", "none")
    .style("pointer-events", "all")
    .style("cursor", "crosshair")
    .on("click", function (event) {
      if (interactionMode !== "guess-intensity") return;
      const [mx] = d3.pointer(event);
      handleGuess(mx);
    })
    .on("mousemove", function (event) {
      if (interactionMode !== "guess-intensity") return;
      const [mx] = d3.pointer(event);
      updateRuler(mx);
    })
    .on("mouseleave", function () {
      hideRuler();
    });

  function updateRuler(mx) {
    rulerLine.attr("x1", mx).attr("x2", mx).style("opacity", 1);
    const dateVal = x.invert(mx);
    rulerText.attr("x", Math.min(width - 100, Math.max(0, mx)))
      .text(formatDateShort(dateVal)).style("opacity", 1);
  }

  function hideRuler() {
    rulerLine.style("opacity", 0);
    rulerText.style("opacity", 0);
    interactionMode = "none";
  }

  function handleGuess(mx) {
    const guessDate = x.invert(mx);
    const actualEvent = floridaMeanData.find(d => d.value > 50);
    let feedbackMsg = "";

    if (actualEvent) {
      const diffHours = (guessDate - actualEvent.date) / (1000 * 60 * 60);
      const absDiff = Math.abs(diffHours);
      if (absDiff < 6) feedbackMsg = `Nice! You were within ${Math.round(absDiff)} hours!`;
      else if (absDiff < 12) feedbackMsg = `Close! You missed by about ${Math.round(absDiff)} hours.`;
      else feedbackMsg = `You missed by ${Math.round(absDiff)} hours - even with spatial maps, prediction is harder than it seems!`;
    } else {
      feedbackMsg = "Interesting guess! Let's see what actually happened.";
    }

    svgGraph.append("path").datum(floridaMeanData).attr("class", "line-full")
      .attr("fill", "none").attr("stroke", "#2b9c85").attr("stroke-width", 2)
      .attr("stroke-dasharray", "5,5").attr("d", line)
      .attr("opacity", 0).transition().duration(1000).attr("opacity", 1);

    svgGraph.append("line").attr("x1", mx).attr("x2", mx)
      .attr("y1", 0).attr("y2", height).attr("stroke", "white").attr("stroke-dasharray", "2,2");

    hideRuler();
    d3.select("#reality-text").html(feedbackMsg).style("display", "block")
      .style("opacity", 0).transition().delay(1000).duration(500).style("opacity", 1);

    interactionMode = "none";
  }
}

function formatDateShort(date) {
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', hour12: true });
}
// --- Interaction 2: Track ---
let lastTrackResult = null;
let firstTrackPoint = null;
let currTrackPrediction = null;
let prevTrackPrediction = null;
let canPredict = false;
function initTrackInteraction() {
  const currFrame = rrqpeData[currFrameidx];
  const centerCoord = getMaxRainfallCoord(currFrame);
  svg
    .append("circle")
    .attr("class", "interaction-result true-center")
    .attr("cx", projection(centerCoord)[0])
    .attr("cy", projection(centerCoord)[1])
    .attr("r", 8)
    .attr("fill", "rgba(255, 0, 0, 0.7)")
    .attr("z", 999);

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
  } else {
    firstTrackPoint = centerCoord;
  }
  lastTrackResult = centerCoord;
}

function drawTrackPrediction() {
  if (!currTrackPrediction) return;
  if (!canPredict) return;
  svg
    .append("circle")
    .attr("class", "interaction-result track-prediction")
    .attr(
      "cx",
      projection([currTrackPrediction.lon, currTrackPrediction.lat])[0]
    )
    .attr(
      "cy",
      projection([currTrackPrediction.lon, currTrackPrediction.lat])[1]
    )
    .attr("r", 8)
    .attr("fill", "rgba(255, 0, 234, 0.7)")
    .attr("z", 999);
  if (prevTrackPrediction) {
    svg
      .append("line")
      .attr("class", "interaction-result track-prediction-line")
      .attr(
        "x1",
        projection([prevTrackPrediction.lon, prevTrackPrediction.lat])[0]
      )
      .attr(
        "y1",
        projection([prevTrackPrediction.lon, prevTrackPrediction.lat])[1]
      )
      .attr(
        "x2",
        projection([currTrackPrediction.lon, currTrackPrediction.lat])[0]
      )
      .attr(
        "y2",
        projection([currTrackPrediction.lon, currTrackPrediction.lat])[1]
      )
      .attr("stroke", "rgba(255, 0, 234, 0.7)")
      .attr("stroke-width", 2)
      .attr("z", 998);
  } else {
    svg
      .append("line")
      .attr("class", "interaction-result track-prediction-line")
      .attr("x1", projection(firstTrackPoint)[0])
      .attr("y1", projection(firstTrackPoint)[1])
      .attr(
        "x2",
        projection([currTrackPrediction.lon, currTrackPrediction.lat])[0]
      )
      .attr(
        "y2",
        projection([currTrackPrediction.lon, currTrackPrediction.lat])[1]
      )
      .attr("stroke", "rgba(255, 0, 234, 0.7)")
      .attr("stroke-width", 2)
      .attr("z", 998);
  }
  prevTrackPrediction = currTrackPrediction;
}

function clearInteractionResults() {
  svg.selectAll(".interaction-result").remove();
}

// --- MAP INTERACTION FEATURES ---
function initDragZoom() {
  const drag = d3
    .drag()
    .on("start", (event) => {
      if (!isGlobeInteractionEnabled) return;
      isDragging = true;
      svg.classed("dragging", true);

      inertiaRotationSpeed = 0;
      lastDragTime = Date.now();
      lastDragX = event.x;
    })
    .on("drag", (event) => {
      if (!isGlobeInteractionEnabled) return;
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
      if (!isGlobeInteractionEnabled) return;
      isDragging = false;
      svg.classed("dragging", false);

      const maxInertiaSpeed = 0.1;
      if (inertiaRotationSpeed > maxInertiaSpeed)
        inertiaRotationSpeed = maxInertiaSpeed;
      if (inertiaRotationSpeed < -maxInertiaSpeed)
        inertiaRotationSpeed = -maxInertiaSpeed;
    });

  svg.call(drag);

  svg.on("wheel", function (event) {
    if (!isGlobeInteractionEnabled) return;
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

function renderRRQPEFrame(frame) {
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

    const dist = d3.geoDistance([lon, lat], [centerLon, centerLat]);
    if (dist > Math.PI / 2) continue;

    const projected = projection([lon, lat]);
    if (!projected) continue;

    const [x, y] = projected;
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

  const arrowLength = 15;
  const arrowHeadSize = 5;

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

    ctx.globalAlpha = 1.0;
    ctx.fillStyle = d3.interpolatePlasma(
      d3.scaleLinear().domain([dmwMin, dmwMax]).clamp(true)(v)
    );
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = 2.5;

    const mag = Math.sqrt(uComp * uComp + vComp * vComp);
    if (mag === 0) continue;

    const scaling = 0.1;
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
  baseSvg.selectAll(".sphere").attr("d", path);
  baseSvg.selectAll(".graticule").attr("d", path);
  landGroup.selectAll("path.land").attr("d", path);

  if (currentFeature === "rainfall") {
    if (currFrameidx !== null) renderRRQPEFrame(rrqpeData[currFrameidx]);
  } else {
    if (dmwData && dmwData.length > 0) {
      let closestFrame = null;
      let minDiff = Infinity;

      for (const frame of dmwData) {
        const diff = Math.abs(new Date(frame.datetime) - currDateTime);
        if (diff < minDiff) {
          minDiff = diff;
          closestFrame = frame;
        }
      }

      if (minDiff < 1.5 * 60 * 60 * 1000) {
        renderDMWFrame(closestFrame);
      } else {
        ctx.clearRect(0, 0, width, height);
      }
    }
  }

  if (!svg.selectAll(".region-marker").empty()) {
    updateGlobeVisuals();
  }
}

function handleMapClick(event) {
  if (interactionMode === "none") return;

  const [x, y] = d3.pointer(event);
  const coords = projection.invert([x, y]);
  if (!coords) return;

  const [lon, lat] = coords;

  if (interactionMode === "guess-track") {
    currTrackPrediction = { lon, lat };
    console.log("Track Prediction:", currTrackPrediction);
    drawTrackPrediction();
    interactionMode = "none";
    canPredict = false;
    const predictionFeedback = d3.select("#prediction-feedback");

    predictionFeedback
      .style("display", "block")
      .style("opacity", 0)
      .transition()
      .delay(500)
      .duration(500)
      .style("opacity", 1);
  }
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

// --- Interaction 3: Resource Allocation Game ---
const floridaRegions = [
  { id: "panhandle", name: "Panhandle", lat: 30.5, lon: -85.5, rainImpact: 30, windImpact: 40, pop: 1 },
  { id: "bigbend", name: "Big Bend", lat: 29.8, lon: -83.5, rainImpact: 50, windImpact: 90, pop: 1 },
  { id: "tampa", name: "Tampa Bay", lat: 27.9, lon: -82.5, rainImpact: 90, windImpact: 70, pop: 3 },
  { id: "orlando", name: "Central / Orlando", lat: 28.5, lon: -81.4, rainImpact: 60, windImpact: 50, pop: 3 },
  { id: "southwest", name: "Southwest", lat: 26.6, lon: -81.9, rainImpact: 40, windImpact: 60, pop: 2 },
  { id: "eastcoast", name: "East Coast", lat: 28.0, lon: -80.6, rainImpact: 40, windImpact: 40, pop: 2 },
  { id: "south", name: "South Florida", lat: 25.8, lon: -80.2, rainImpact: 20, windImpact: 30, pop: 3 }
];

let allocatedRain = {};
let allocatedWind = {};
const MAX_RAIN_UNITS = 100;
const MAX_WIND_UNITS = 100;

function initResourceGame() {
  const container = d3.select("#game-controls-container");
  container.html("");

  floridaRegions.forEach(region => {
    allocatedRain[region.id] = 0;
    allocatedWind[region.id] = 0;

    const div = container.append("div").attr("class", "region-control");
    div.append("h4").text(region.name);

    const rainGroup = div.append("div").attr("class", "slider-group rain");
    rainGroup.append("label").html(`Rain: <span id="rain-val-${region.id}">0</span>`);
    rainGroup.append("input")
      .attr("type", "range")
      .attr("min", 0).attr("max", 50)
      .attr("value", 0)
      .on("input", function () {
        const val = +this.value;
        const clamped = updateAllocation(region.id, "rain", val);
        if (clamped !== val) {
          this.value = clamped;
        }
      });

    const windGroup = div.append("div").attr("class", "slider-group wind");
    windGroup.append("label").html(`Wind: <span id="wind-val-${region.id}">0</span>`);
    windGroup.append("input")
      .attr("type", "range")
      .attr("min", 0).attr("max", 50)
      .attr("value", 0)
      .on("input", function () {
        const val = +this.value;
        const clamped = updateAllocation(region.id, "wind", val);
        if (clamped !== val) {
          this.value = clamped;
        }
      });
  });

  d3.select("#submit-plan-btn").on("click", submitPlan);

  updateStats();
  renderRegionsOnGlobe();
}

function updateAllocation(regionId, type, value) {
  const store = type === "rain" ? allocatedRain : allocatedWind;
  const maxTotal = type === "rain" ? MAX_RAIN_UNITS : MAX_WIND_UNITS;

  let otherTotal = 0;
  Object.keys(store).forEach(k => {
    if (k !== regionId) otherTotal += store[k];
  });

  const available = maxTotal - otherTotal;
  let newValue = value;
  if (newValue > available) {
    newValue = available;
  }

  store[regionId] = newValue;
  d3.select(`#${type}-val-${regionId}`).text(newValue);

  updateStats();
  updateGlobeVisuals();

  return newValue;
}

function updateStats() {
  const totalRain = Object.values(allocatedRain).reduce((a, b) => a + b, 0);
  const totalWind = Object.values(allocatedWind).reduce((a, b) => a + b, 0);

  d3.select("#rain-left").text(MAX_RAIN_UNITS - totalRain);
  d3.select("#wind-left").text(MAX_WIND_UNITS - totalWind);
}

function renderRegionsOnGlobe() {
  svg.selectAll(".region-marker").remove();

  svg.selectAll(".region-marker")
    .data(floridaRegions)
    .enter()
    .append("circle")
    .attr("class", "region-marker")
    .attr("r", 5)
    .attr("fill", "rgba(255,255,255,0.3)")
    .attr("stroke", "white")
    .attr("stroke-width", 1);

  updateGlobeVisuals();
}

function updateGlobeVisuals() {
  svg.selectAll(".region-marker")
    .attr("cx", d => projection([d.lon, d.lat]) ? projection([d.lon, d.lat])[0] : -100)
    .attr("cy", d => projection([d.lon, d.lat]) ? projection([d.lon, d.lat])[1] : -100)
    .attr("fill", d => {
      const r = allocatedRain[d.id];
      const w = allocatedWind[d.id];
      if (r > w) return `rgba(59, 130, 246, ${0.3 + r / 100})`;
      if (w > r) return `rgba(239, 68, 68, ${0.3 + w / 100})`;
      return "rgba(255,255,255,0.3)";
    })
    .attr("r", d => {
      const total = allocatedRain[d.id] + allocatedWind[d.id];
      return 5 + total / 5;
    });
}

function submitPlan() {
  let score = 0;
  let maxScore = 0;
  let feedback = "";

  floridaRegions.forEach(r => {
    const targetRain = r.rainImpact / 2;
    const targetWind = r.windImpact / 2;
    const rainDiff = Math.abs(allocatedRain[r.id] - targetRain);
    const windDiff = Math.abs(allocatedWind[r.id] - targetWind);
    const weight = r.pop;

    score += (100 - (rainDiff + windDiff)) * weight;
    maxScore += 100 * weight;

    if (r.id === "tampa" && allocatedRain[r.id] < 10) {
      feedback += `<p><strong>Tampa Bay</strong>: Heavy flooding occurred here. Your rain allocation was dangerously low.</p>`;
    }
  });

  const finalScore = Math.round((score / maxScore) * 100);

  d3.select("#final-score").text(`${finalScore}/100`);

  if (feedback === "") {
    if (finalScore > 80) feedback = "<p>Excellent work! Your resource allocation closely matched the actual impact patterns.</p>";
    else feedback = "<p>You saved many, but some high-risk areas were under-protected. Review the map to see where Helene hit hardest.</p>";
  }

  d3.select("#feedback-details").html(feedback);
  d3.select("#simulation-results").classed("hidden", false);
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
      response.element.classList.add("is-active");
      const step = response.element.dataset.step;
      const behavior = response.element.dataset.behavior;

      d3.select("#globe-container").classed("cursor-crosshair", false);
      interactionMode = "none";

      if (
        step === "scene1" ||
        step === "spacer1" ||
        step === "scene10" ||
        step === "scene11" ||
        step === "scene12" ||
        step === "scene13" ||
        step === "scene14" ||
        step === "scene15" ||
        step === "scene16" ||
        step === "scene17"
      ) {
        isGlobeInteractionEnabled = true;
      } else {
        isGlobeInteractionEnabled = false;
        baseSvg.style("pointer-events", "none");
        canvas.style("pointer-events", "none");
        svg.style("pointer-events", "auto");
      }

      if (step !== "scene3" && step !== "scene4" && step !== "scene5") {
        d3.select("#mini-heatmap-container").classed("hidden", true);
      }

      if (step === "scene3" || step === "scene4" || step === "scene5") {
        if (floridaMeanData.length === 0) initLineGraph();
      }

      if (step === "scene10" || step === "scene11" || step === "scene12") {
        if (Object.keys(allocatedRain).length === 0) initResourceGame();
        renderRegionsOnGlobe();
        const targetDate = new Date("2024-09-26T18:00:00Z");
        const targetIdx = rrqpeData.findIndex(d => new Date(d.datetime) >= targetDate);
        if (targetIdx !== -1 && currFrameidx !== targetIdx) {
          onFrameChange(targetIdx);
        }

        const targetScale = width * 2;
        const targetRotate = [82, -28];

        d3.transition()
          .duration(800)
          .tween("rotate", () => {
            const r = d3.interpolate(projection.rotate(), targetRotate);
            const s = d3.interpolate(projection.scale(), targetScale);
            return (t) => {
              projection.rotate(r(t));
              projection.scale(s(t));
              currentScale = s(t);
              redraw();
              updateGlobeVisuals();
            };
          });
      } else {
        svg.selectAll(".region-marker").remove();
      }

      if (
        step !== "scene6" &&
        step !== "scene7" &&
        step !== "scene8" &&
        step !== "scene9"
      ) {
        clearInteractionResults();
        lastTrackResult = null;
        currTrackPrediction = null;
        prevTrackPrediction = null;
        canPredict = false;
      }
      if (step === "scene6") {
        interactionMode = "guess-track";
        canPredict = true;
        if (scrollDirection > 0) {
          initTrackInteraction();
        }
      }

      if (step === "scene7") {
        interactionMode = "guess-track";
        canPredict = true;
        if (scrollDirection > 0) {
          initTrackInteraction();
        }
      }

      if (step === "scene8") {
        interactionMode = "guess-track";
        canPredict = true;
        if (scrollDirection > 0) {
          initTrackInteraction();
        }
      }

      if (step === "scene9") {
        if (scrollDirection > 0) {
          initTrackInteraction();
        }
      }

      if (behavior === "guess-intensity") {
        interactionMode = "guess-intensity";
      } else if (behavior === "guess-track") {
        interactionMode = "guess-track";
        d3.select("#globe-container").classed("cursor-crosshair", true);
      }

      if (step === "scene2" || step === "scene6") {
        d3.select("#controls-container").classed("hidden", false);
        const targetScale = width * 1.2;
        const targetRotate = [80, -30.5];
        const targetTranslate = [width / 2, height / 2 - height * 0.15];

        d3.transition()
          .duration(800)
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
      } else if (
        step === "scene1" ||
        step === "spacer1" ||
        step === "scene13" ||
        step === "scene14" ||
        step === "scene15" ||
        step === "scene16" ||
        step === "scene17"
      ) {
        const targetScale = width * 0.2;
        const targetRotate = [80, 0];
        const targetTranslate = [width / 2, height / 2];

        d3.select("#controls-container").classed("hidden", true);
        const toggleInput = document.getElementById("feature-toggle");
        currentFeature = "rainfall";
        if (toggleInput) toggleInput.checked = false;
        initColorScale(
          "Rainfall Rate (mm/hr)",
          rrqpeMin,
          rrqpeMax,
          d3.interpolateTurbo
        );

        d3.transition()
          .duration(800)
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

  const onScroll = () => {
    const doc = document.documentElement;
    const scrollTop = doc.scrollTop || document.body.scrollTop || 0;
    const scrollHeight = (doc.scrollHeight || 0) - window.innerHeight;
    const newScrollDirection = scrollTop > (window.lastScrollTop || 0) ? 1 : -1;
    window.lastScrollTop = scrollTop;
    scrollDirection = newScrollDirection;

    if (scrollHeight <= 0) return;

    const scene1El = document.querySelector('.step[data-step="scene1"]');
    const spacerEl = document.querySelector('.step[data-step="spacer1"]');

    if (!scene1El || !spacerEl || !n6hrFrames || n6hrFrames <= 1) {
      const t = Math.min(Math.max(scrollTop / scrollHeight, 0), 1);
      const mapped = Math.floor(t * (rrqpeData.length - 1));
      if (mapped !== currFrameidx) onFrameChange(mapped);
      return;
    }

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
      const t = (scrollTop - rangeStart) / Math.max(1, rangeEnd - rangeStart);
      const idx = Math.floor(t * (n6hrFrames - 1));
      mapped = Math.min(Math.max(idx, 0), n6hrFrames - 1);
    } else {
      const remainingFrames = Math.max(1, rrqpeData.length - n6hrFrames);
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
  onScroll();
}

function initColorScale(title, min, max, interpolator) {
  const legendWidth = 20;
  const legendHeight = 300;

  d3.select("#color-legend").html("");

  const legend = d3
    .select("#color-legend")
    .style("display", "flex")
    .style("flex-direction", "row")
    .style("align-items", "center")
    .style("gap", "8px");

  const canvas = legend
    .append("canvas")
    .attr("width", legendWidth)
    .attr("height", legendHeight)
    .style("border", "1px solid #ccc");

  const ctx = canvas.node().getContext("2d");

  const valueScale = d3.scaleLinear().domain([min, max]).range([1, 0]);

  const colorScale = d3
    .scaleSequential()
    .domain([1, 0])
    .interpolator(interpolator);

  for (let y = 0; y < legendHeight; y++) {
    const t = y / legendHeight;
    ctx.fillStyle = colorScale(t);
    ctx.fillRect(0, y, legendWidth, 1);
  }

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
  currFrameidx = idx;
  const frame = rrqpeData[idx];

  currDateTime = new Date(frame.datetime);

  document.getElementById("date").textContent = formatDate(currDateTime);

  document.getElementById("time").textContent = `${String(
    currDateTime.getUTCHours()
  ).padStart(2, "0")}:00`;

  renderRRQPEFrame(frame);
}

async function init() {
  const overlay = document.getElementById("loading-overlay");

  const [world, rrqpe6hr, rrqpeHourly, dmwDataRaw] = await Promise.all([
    d3.json(
      "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json"
    ),
    preload6hrRRQPE(),
    loadDailyRRQPE(),
    loadDMWData(),
  ]);

  n6hrFrames = rrqpe6hr.length;
  rrqpeHelene = rrqpeHourly;
  const rrqpe = [...rrqpe6hr, ...rrqpeHourly];

  rrqpeMax = d3.max(rrqpe, (d) => d3.max(d.vals));
  rrqpeMin = d3.min(rrqpe, (d) => d3.min(d.vals));

  if (dmwDataRaw) {
    dmwData = dmwDataRaw;
    dmwMax = d3.max(dmwData, (d) => d3.max(d.vals));
    dmwMin = d3.min(dmwData, (d) => d3.min(d.vals));
  }

  rrqpeData = rrqpe;
  currFrameidx = 0;
  currDateTime = new Date(rrqpeData[0].datetime);

  initGlobe(world);
  initDragZoom();
  initColorScale(
    "Rainfall Rate (mm/hr)",
    rrqpeMin,
    rrqpeMax,
    d3.interpolateTurbo
  );

  const toggleInput = document.getElementById("feature-toggle");
  toggleInput.addEventListener("change", (e) => {
    if (e.target.checked) {
      currentFeature = "wind";
      initColorScale("Wind Speed (m/s)", dmwMin, dmwMax, d3.interpolatePlasma);
    } else {
      currentFeature = "rainfall";
      initColorScale(
        "Rainfall Rate (mm/hr)",
        rrqpeMin,
        rrqpeMax,
        d3.interpolateTurbo
      );
    }
    redraw();
  });

  initScrollytelling(rrqpeData.length);

  const continueBtn = document.getElementById("continue-btn");
  continueBtn.classList.remove("hidden");
  setTimeout(() => continueBtn.classList.add("visible"), 100);

  continueBtn.addEventListener("click", () => {
    overlay.classList.add("hidden");
    document.querySelectorAll(".hint").forEach(el => el.classList.add("animate"));
  });

  redraw();
  animate();
}

init();
