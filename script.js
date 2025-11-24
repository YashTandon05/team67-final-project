const width = 700;
const height = 700;

const svg = d3
  .select("#globe-container")
  .append("svg")
  .attr("viewBox", `0 0 ${width} ${height}`)
  .attr("preserveAspectRatio", "xMidYMid meet");

let currentScale = width * 0.45;
const minScale = width * 0.2;
const maxScale = width * 1.5;

const projection = d3.geoOrthographic().scale(currentScale).translate([width / 2, height / 2]).clipAngle(90);
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

const drag = d3.drag().on("start", (event) => {
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
    if (inertiaRotationSpeed > maxInertiaSpeed) inertiaRotationSpeed = maxInertiaSpeed;
    if (inertiaRotationSpeed < -maxInertiaSpeed) inertiaRotationSpeed = -maxInertiaSpeed;
  });

svg.call(drag);

// Add zoom functionality with mouse wheel
svg.on("wheel", function(event) {
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

    landGroup.selectAll("path")
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


// Time slider functionality
const startDate = new Date(2024, 0, 1);
const endDate = new Date(2024, 11, 31);
const totalDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
const totalSteps = totalDays * 2;

function formatDate(date) {
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

function formatTime(date) {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

function getDateFromStep(stepIndex) {
  const dayIndex = Math.floor(stepIndex / 2);
  const hourOffset = (stepIndex % 2) * 12;
  const date = new Date(startDate);
  date.setDate(date.getDate() + dayIndex);
  date.setHours(hourOffset, 0, 0, 0);
  return date;
}

function updateTimeDisplay(stepIndex) {
  const date = getDateFromStep(stepIndex);
  document.getElementById("current-date").textContent = formatDate(date);
  document.getElementById("current-time").textContent = formatTime(date);
}

const timeSlider = document.getElementById("time-slider");
timeSlider.max = totalSteps - 1;

timeSlider.addEventListener("input", (e) => {
  const stepIndex = parseInt(e.target.value);
  updateTimeDisplay(stepIndex);
});

updateTimeDisplay(0);