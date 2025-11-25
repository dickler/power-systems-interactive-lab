// Constants
const OMEGA = 2 * Math.PI;
const T_MAX = 2.0;
const POINTS = 200;
const ANGLES = [0, 120 * Math.PI / 180, 240 * Math.PI / 180];

// Colors (matching Python version)
const COLORS_POS = ['#FF5555', '#55FF55', '#5555FF'];
const COLORS_NEG = ['#FF55FF', '#55FFFF', '#FFFF55'];
const COLOR_RES_POS = '#FFFFFF';
const COLOR_RES_NEG = '#AAAAAA';
const COLOR_GRID = '#333333';
const COLOR_AXIS = '#666666';

// State
let state = {
    t: Array.from({ length: POINTS }, (_, i) => i * T_MAX / (POINTS - 1)),
    frame: 0,
    isPlaying: false,
    loop: true,
    ampPos: 1.0,
    ampNeg: 0.1,
    decomposition: false,
    showTraj: false,
    showRotFields: false,
    extraTraj: false,
    trajPointsPos: [],
    trajPointsNeg: [],
    trajPointsComb: [],
    trajPointsExtraPos: [],
    trajPointsExtraNeg: [],
    // Zoom/Pan State per Canvas
    viewStates: {}, // Keyed by canvas ID: { scale: 1, offsetX: 0, offsetY: 0 }
    isDragging: false,
    activeCanvasId: null,
    lastMouseX: 0,
    lastMouseY: 0
};

// Animation Loop Control
let lastFrameTime = 0;
const FRAME_DELAY = 50; // 50ms = 20fps

// DOM Elements
const els = {
    slider: document.getElementById('time-slider'),
    timeDisplay: document.getElementById('time-display'),
    playBtn: document.getElementById('play-btn'),
    resetBtn: document.getElementById('reset-btn'),
    loopCheck: document.getElementById('loop-check'),
    ampPos: document.getElementById('amp-pos'),
    ampNeg: document.getElementById('amp-neg'),
    decompCheck: document.getElementById('decomp-check'),
    trajCheck: document.getElementById('traj-check'),
    rotFieldsCheck: document.getElementById('rot-fields-check'),
    extraTrajCheck: document.getElementById('extra-traj-check'),
    canvases: {
        fieldPos: document.getElementById('field-pos'),
        fieldNeg: document.getElementById('field-neg'),
        fieldComb: document.getElementById('field-comb'),
        signalPos: document.getElementById('signal-pos'),
        signalNeg: document.getElementById('signal-neg'),
        signalComb: document.getElementById('signal-comb')
    }
};

// Contexts
const ctxs = {};
for (const [key, canvas] of Object.entries(els.canvases)) {
    ctxs[key] = canvas.getContext('2d');
    // Initialize view state for each canvas
    state.viewStates[canvas.id] = { scale: 1.0, offsetX: 0, offsetY: 0 };
}

// Initialization
function init() {
    console.log("Initializing...");
    resizeCanvases();
    window.addEventListener('resize', resizeCanvases);

    // Event Listeners
    els.playBtn.addEventListener('click', togglePlay);
    els.resetBtn.addEventListener('click', reset);
    els.slider.addEventListener('input', (e) => updateFrame(parseInt(e.target.value)));

    els.loopCheck.addEventListener('change', (e) => state.loop = e.target.checked);

    els.ampPos.addEventListener('input', (e) => {
        state.ampPos = parseFloat(e.target.value);
        computeSignals();
        draw();
    });
    els.ampNeg.addEventListener('input', (e) => {
        state.ampNeg = parseFloat(e.target.value);
        computeSignals();
        draw();
    });

    els.decompCheck.addEventListener('change', (e) => {
        state.decomposition = e.target.checked;
        draw();
    });

    els.trajCheck.addEventListener('change', (e) => {
        state.showTraj = e.target.checked;
        if (!state.showTraj) clearTrajectories();
        updateExtraTrajState();
        draw();
    });

    els.rotFieldsCheck.addEventListener('change', (e) => {
        state.showRotFields = e.target.checked;
        updateExtraTrajState();
        draw();
    });

    els.extraTrajCheck.addEventListener('change', (e) => {
        state.extraTraj = e.target.checked;
        if (!state.extraTraj) {
            state.trajPointsExtraPos = [];
            state.trajPointsExtraNeg = [];
        }
        draw();
    });

    // Zoom/Pan Listeners on all canvases
    Object.values(els.canvases).forEach(canvas => {
        canvas.addEventListener('wheel', handleZoom);
        canvas.addEventListener('mousedown', handleMouseDown);
        canvas.addEventListener('mousemove', handleMouseMove);
        canvas.addEventListener('mouseup', handleMouseUp);
        canvas.addEventListener('mouseleave', handleMouseUp);
    });

    computeSignals();
    console.log("Signals computed. Length:", signalsPos.length);
    draw();
    animate(0);
}

function updateExtraTrajState() {
    const enabled = state.showTraj && state.showRotFields;
    els.extraTrajCheck.disabled = !enabled;
    if (!enabled) {
        els.extraTrajCheck.checked = false;
        state.extraTraj = false;
        state.trajPointsExtraPos = [];
        state.trajPointsExtraNeg = [];
    }
}

function resizeCanvases() {
    console.log("Resizing canvases...");
    for (const [key, canvas] of Object.entries(els.canvases)) {
        const rect = canvas.parentElement.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;
    }
    draw();
}

// Zoom/Pan Logic
function handleZoom(e) {
    e.preventDefault();
    const canvasId = e.target.id;
    const viewState = state.viewStates[canvasId];
    if (!viewState) return;

    const zoomIntensity = 0.1;
    const delta = e.deltaY > 0 ? -zoomIntensity : zoomIntensity;
    const newScale = viewState.scale + delta;

    // Limit zoom
    viewState.scale = Math.min(Math.max(0.1, newScale), 5.0);
    draw();
}

function handleMouseDown(e) {
    state.isDragging = true;
    state.activeCanvasId = e.target.id;
    state.lastMouseX = e.clientX;
    state.lastMouseY = e.clientY;
}

function handleMouseMove(e) {
    if (!state.isDragging || !state.activeCanvasId) return;

    const viewState = state.viewStates[state.activeCanvasId];
    if (!viewState) return;

    const dx = e.clientX - state.lastMouseX;
    const dy = e.clientY - state.lastMouseY;

    viewState.offsetX += dx;
    viewState.offsetY += dy;

    state.lastMouseX = e.clientX;
    state.lastMouseY = e.clientY;
    draw();
}

function handleMouseUp() {
    state.isDragging = false;
    state.activeCanvasId = null;
}

// Math & Logic
let signalsPos, signalsNeg, signalsComb;

function computeSignals() {
    signalsPos = [];
    signalsNeg = [];
    signalsComb = [];

    for (let i = 0; i < POINTS; i++) {
        const ti = state.t[i];
        const rowPos = ANGLES.map(angle => state.ampPos * Math.cos(OMEGA * ti - angle));
        const rowNeg = ANGLES.map(angle => state.ampNeg * Math.cos(OMEGA * ti + angle));
        const rowComb = rowPos.map((v, idx) => v + rowNeg[idx]);

        signalsPos.push(rowPos);
        signalsNeg.push(rowNeg);
        signalsComb.push(rowComb);
    }
}

function togglePlay() {
    state.isPlaying = !state.isPlaying;
    els.playBtn.textContent = state.isPlaying ? "Pause" : "Play";
}

function reset() {
    state.isPlaying = false;
    els.playBtn.textContent = "Play";
    state.frame = 0;
    els.slider.value = 0;

    // Reset all view states
    for (const key in state.viewStates) {
        state.viewStates[key] = { scale: 1.0, offsetX: 0, offsetY: 0 };
    }

    clearTrajectories();
    draw();
}

function clearTrajectories() {
    state.trajPointsPos = [];
    state.trajPointsNeg = [];
    state.trajPointsComb = [];
    state.trajPointsExtraPos = [];
    state.trajPointsExtraNeg = [];
}

function updateFrame(frame) {
    state.frame = frame;
    els.timeDisplay.textContent = state.t[frame].toFixed(2);

    if (state.showTraj) {
        const getRes = (sigs, frame) => {
            let x = 0, y = 0;
            for (let i = 0; i < 3; i++) {
                x += sigs[frame][i] * Math.cos(ANGLES[i]);
                y += sigs[frame][i] * Math.sin(ANGLES[i]);
            }
            return { x, y };
        };

        const resPos = getRes(signalsPos, frame);
        const resNeg = getRes(signalsNeg, frame);
        const resComb = { x: resPos.x + resNeg.x, y: resPos.y + resNeg.y };

        state.trajPointsPos.push(resPos);
        state.trajPointsNeg.push(resNeg);
        state.trajPointsComb.push(resComb);

        if (state.extraTraj && state.showRotFields) {
            state.trajPointsExtraPos.push(resPos);
            state.trajPointsExtraNeg.push(resComb);
        }
    }

    draw();
}

function animate(timestamp) {
    if (state.isPlaying) {
        if (timestamp - lastFrameTime >= FRAME_DELAY) {
            let nextFrame = state.frame + 1;
            if (nextFrame >= POINTS) {
                if (state.loop) {
                    nextFrame = 0;
                    clearTrajectories();
                } else {
                    state.isPlaying = false;
                    els.playBtn.textContent = "Play";
                    nextFrame = POINTS - 1;
                }
            }
            state.frame = nextFrame;
            els.slider.value = state.frame;
            updateFrame(state.frame);
            lastFrameTime = timestamp;
        }
    }
    requestAnimationFrame(animate);
}

// Drawing
function draw() {
    if (!signalsPos || !signalsPos.length) return;

    drawField(ctxs.fieldPos, els.canvases.fieldPos.id, signalsPos, COLORS_POS, state.trajPointsPos, 'pos');
    drawField(ctxs.fieldNeg, els.canvases.fieldNeg.id, signalsNeg, COLORS_NEG, state.trajPointsNeg, 'neg');
    drawField(ctxs.fieldComb, els.canvases.fieldComb.id, signalsComb, COLORS_POS.concat(COLORS_NEG), state.trajPointsComb, 'comb');

    drawSignals(ctxs.signalPos, els.canvases.signalPos.id, signalsPos, COLORS_POS, "Positive");
    drawSignals(ctxs.signalNeg, els.canvases.signalNeg.id, signalsNeg, COLORS_NEG, "Negative");
    drawSignals(ctxs.signalComb, els.canvases.signalComb.id, signalsComb, COLORS_POS, "Combined");
}

function drawGrid(ctx, w, h, cx, cy, baseScale, viewState) {
    ctx.strokeStyle = COLOR_GRID;
    ctx.lineWidth = 1 / viewState.scale;
    ctx.beginPath();

    // Adaptive Step Calculation
    let step = baseScale;
    const minSpacing = 40;
    const maxSpacing = 120;

    // Adjust step to be within acceptable pixel range
    while (step * viewState.scale < minSpacing) step *= 2;
    while (step * viewState.scale > maxSpacing) step /= 2;

    // Calculate visible bounds in local coordinates
    const s = viewState.scale;
    const ox = viewState.offsetX;
    const oy = viewState.offsetY;

    const xMin = (-ox - w / 2) / s + w / 2;
    const xMax = (w - ox - w / 2) / s + w / 2;
    const yMin = (-oy - h / 2) / s + h / 2;
    const yMax = (h - oy - h / 2) / s + h / 2;

    // Vertical lines
    const iMin = Math.floor((xMin - cx) / step);
    const iMax = Math.ceil((xMax - cx) / step);

    for (let i = iMin; i <= iMax; i++) {
        const x = cx + i * step;
        ctx.moveTo(x, yMin);
        ctx.lineTo(x, yMax);
    }

    // Horizontal lines
    const jMin = Math.floor((yMin - cy) / step);
    const jMax = Math.ceil((yMax - cy) / step);

    for (let j = jMin; j <= jMax; j++) {
        const y = cy + j * step;
        ctx.moveTo(xMin, y);
        ctx.lineTo(xMax, y);
    }

    ctx.stroke();

    // Axes
    ctx.strokeStyle = COLOR_AXIS;
    ctx.lineWidth = 2 / viewState.scale;
    ctx.beginPath();
    // Y-axis at cx
    if (cx >= xMin && cx <= xMax) {
        ctx.moveTo(cx, yMin); ctx.lineTo(cx, yMax);
    }
    // X-axis at cy
    if (cy >= yMin && cy <= yMax) {
        ctx.moveTo(xMin, cy); ctx.lineTo(xMax, cy);
    }
    ctx.stroke();
}

function drawField(ctx, canvasId, signals, colors, trajPoints, type) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const viewState = state.viewStates[canvasId];

    ctx.save();
    ctx.clearRect(0, 0, w, h);

    // Apply Zoom/Pan
    ctx.translate(viewState.offsetX, viewState.offsetY);
    ctx.translate(w / 2, h / 2);
    ctx.scale(viewState.scale, viewState.scale);
    ctx.translate(-w / 2, -h / 2);

    const cx = w / 2;
    const cy = h / 2;
    const baseScale = Math.min(w, h) / 8; // Base scale factor

    // Draw Grid
    drawGrid(ctx, w, h, cx, cy, baseScale, viewState);

    // Vectors
    const frame = state.frame;
    let vectors = [];

    if (type === 'comb') {
        for (let i = 0; i < 3; i++) {
            vectors.push({ x: signalsPos[frame][i] * Math.cos(ANGLES[i]), y: signalsPos[frame][i] * Math.sin(ANGLES[i]), c: COLORS_POS[i] });
        }
        for (let i = 0; i < 3; i++) {
            vectors.push({ x: signalsNeg[frame][i] * Math.cos(ANGLES[i]), y: signalsNeg[frame][i] * Math.sin(ANGLES[i]), c: COLORS_NEG[i] });
        }
    } else {
        const sigs = (type === 'pos') ? signalsPos : signalsNeg;
        const cols = (type === 'pos') ? COLORS_POS : COLORS_NEG;
        for (let i = 0; i < 3; i++) {
            vectors.push({ x: sigs[frame][i] * Math.cos(ANGLES[i]), y: sigs[frame][i] * Math.sin(ANGLES[i]), c: cols[i] });
        }
    }

    // Draw Vectors
    let currentX = 0;
    let currentY = 0;

    // Resultant calculation
    let resX = 0;
    let resY = 0;
    vectors.forEach(v => { resX += v.x; resY += v.y; });

    if (state.decomposition) {
        // Tip-to-tail
        vectors.forEach(v => {
            drawArrow(ctx, cx + currentX * baseScale, cy - currentY * baseScale, cx + (currentX + v.x) * baseScale, cy - (currentY + v.y) * baseScale, v.c, 3, false, viewState);
            currentX += v.x;
            currentY += v.y;
        });
        // Resultant
        drawArrow(ctx, cx, cy, cx + resX * baseScale, cy - resY * baseScale, COLOR_RES_POS, 4, false, viewState);
    } else {
        // Origin-based
        vectors.forEach(v => {
            drawArrow(ctx, cx, cy, cx + v.x * baseScale, cy - v.y * baseScale, v.c, 3, false, viewState);
        });
        // Resultant
        drawArrow(ctx, cx, cy, cx + resX * baseScale, cy - resY * baseScale, COLOR_RES_POS, 4, false, viewState);
    }

    // Extra Rotating Fields (Combined Only)
    if (type === 'comb' && state.showRotFields) {
        let rx_pos = 0, ry_pos = 0;
        for (let i = 0; i < 3; i++) {
            rx_pos += signalsPos[frame][i] * Math.cos(ANGLES[i]);
            ry_pos += signalsPos[frame][i] * Math.sin(ANGLES[i]);
        }

        let rx_neg = 0, ry_neg = 0;
        for (let i = 0; i < 3; i++) {
            rx_neg += signalsNeg[frame][i] * Math.cos(ANGLES[i]);
            ry_neg += signalsNeg[frame][i] * Math.sin(ANGLES[i]);
        }

        drawArrow(ctx, cx, cy, cx + rx_pos * baseScale, cy - ry_pos * baseScale, COLOR_RES_POS, 2, true, viewState);
        drawArrow(ctx, cx + rx_pos * baseScale, cy - ry_pos * baseScale, cx + (rx_pos + rx_neg) * baseScale, cy - (ry_pos + ry_neg) * baseScale, COLOR_RES_NEG, 2, true, viewState);
    }

    // Trajectories
    if (state.showTraj) {
        drawTrajectory(ctx, trajPoints, cx, cy, baseScale, COLOR_RES_POS, false, viewState);

        if (type === 'comb' && state.extraTraj && state.showRotFields) {
            drawTrajectory(ctx, state.trajPointsExtraPos, cx, cy, baseScale, COLOR_RES_POS, true, viewState);
            drawTrajectory(ctx, state.trajPointsExtraNeg, cx, cy, baseScale, COLOR_RES_NEG, true, viewState);
        }
    }

    ctx.restore();
}

function drawArrow(ctx, x1, y1, x2, y2, color, width = 3, dashed = false, viewState) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width / viewState.scale; // Keep line width constant visually
    if (dashed) ctx.setLineDash([5, 5]);
    else ctx.setLineDash([]);
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Tip
    ctx.beginPath();
    ctx.fillStyle = color;
    // Keep tip size constant visually
    ctx.arc(x2, y2, (width * 1.5) / viewState.scale, 0, Math.PI * 2);
    ctx.fill();
}

function drawTrajectory(ctx, points, cx, cy, scale, color, dotted = false, viewState) {
    if (points.length < 2) return;
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1 / viewState.scale;
    if (dotted) ctx.setLineDash([2, 4]);
    ctx.moveTo(cx + points[0].x * scale, cy - points[0].y * scale);
    for (let i = 1; i < points.length; i++) {
        ctx.lineTo(cx + points[i].x * scale, cy - points[i].y * scale);
    }
    ctx.stroke();
    ctx.setLineDash([]);
}

function drawSignals(ctx, canvasId, signals, colors, type) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const viewState = state.viewStates[canvasId];

    ctx.save();
    ctx.clearRect(0, 0, w, h);

    // Apply Zoom/Pan
    ctx.translate(viewState.offsetX, viewState.offsetY);
    ctx.translate(w / 2, h / 2);
    ctx.scale(viewState.scale, viewState.scale);
    ctx.translate(-w / 2, -h / 2);

    const cx = 0; // Start from left
    const cy = h / 2;
    const xScale = w / (POINTS - 1);
    const yScale = h / 8; // Scale factor

    // Grid
    ctx.strokeStyle = COLOR_GRID;
    ctx.lineWidth = 1 / viewState.scale;
    ctx.beginPath();

    // Calculate visible bounds
    const s = viewState.scale;
    const ox = viewState.offsetX;
    const oy = viewState.offsetY;

    const xMin = (-ox - w / 2) / s + w / 2;
    const xMax = (w - ox - w / 2) / s + w / 2;
    const yMin = (-oy - h / 2) / s + h / 2;
    const yMax = (h - oy - h / 2) / s + h / 2;

    // Horizontal grid lines (Amplitude)
    let hStep = yScale;
    const minSpacing = 40;
    const maxSpacing = 120;

    while (hStep * s < minSpacing) hStep *= 2;
    while (hStep * s > maxSpacing) hStep /= 2;

    const jMin = Math.floor((yMin - cy) / hStep);
    const jMax = Math.ceil((yMax - cy) / hStep);

    for (let j = jMin; j <= jMax; j++) {
        const y = cy + j * hStep;
        ctx.moveTo(xMin, y);
        ctx.lineTo(xMax, y);
    }

    // Vertical grid lines (Time)
    let vStep = xScale * 20; // Default every 20 points
    while (vStep * s < minSpacing) vStep *= 2;
    while (vStep * s > maxSpacing) vStep /= 2;

    const iMin = Math.floor(xMin / vStep);
    const iMax = Math.ceil(xMax / vStep);

    for (let i = iMin; i <= iMax; i++) {
        const x = i * vStep;
        ctx.moveTo(x, yMin);
        ctx.lineTo(x, yMax);
    }

    ctx.stroke();

    // Main Axis
    ctx.strokeStyle = COLOR_AXIS;
    ctx.lineWidth = 2 / viewState.scale;
    ctx.beginPath();
    // X-axis at cy
    if (cy >= yMin && cy <= yMax) {
        ctx.moveTo(xMin, cy); ctx.lineTo(xMax, cy);
    }
    ctx.stroke();

    // Draw 3 phases
    for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.strokeStyle = colors[i];
        ctx.lineWidth = 2 / viewState.scale;

        for (let j = 0; j < POINTS; j++) {
            const x = j * xScale;
            const y = cy - signals[j][i] * yScale;
            if (j === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Marker
        const mx = state.frame * xScale;
        const my = cy - signals[state.frame][i] * yScale;
        ctx.beginPath();
        ctx.fillStyle = colors[i];
        ctx.arc(mx, my, 4 / viewState.scale, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.restore();
}

// Start
init();
