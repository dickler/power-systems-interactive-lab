// Constants
const OMEGA = 2 * Math.PI;
const T_MAX = 2.0;
const POINTS = 200;
const ANGLES = [0, 120 * Math.PI / 180, 240 * Math.PI / 180];

// Colors
const COLORS_POS = ['#FF5555', '#55FF55', '#5555FF']; // RGB Bright
const COLORS_NEG = ['#FF55FF', '#55FFFF', '#FFFF55']; // MCY Bright
const COLOR_ALPHA = '#FFA500'; // Orange
const COLOR_BETA = '#00FFFF'; // Cyan
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

    // Amplitudes
    ampPosHarmonics: [1.0, 0.0, 0.0, 0.0, 0.0], // H1-H5
    ampNeg: 0.1,

    // Transform Type
    transformType: 'power', // 'amp' or 'power'

    // Visualization
    decomposition: false,
    showTraj: false,
    showRotFields: false,
    extraTraj: false,

    // Trajectory Points
    trajPointsCombined: [],
    trajPointsExtraPos: [],
    trajPointsExtraNeg: [],
    trajPointsClarke: [],

    // Zoom/Pan State per Canvas
    viewStates: {}, // Keyed by canvas ID
    isDragging: false,
    activeCanvasId: null,
    lastMouseX: 0,
    lastMouseY: 0
};

// Animation Loop Control
let lastFrameTime = 0;
const FRAME_DELAY = 50; // 20fps

// DOM Elements
const els = {
    slider: document.getElementById('time-slider'),
    timeDisplay: document.getElementById('time-display'),
    playBtn: document.getElementById('play-btn'),
    resetBtn: document.getElementById('reset-btn'),
    loopCheck: document.getElementById('loop-check'),

    ampInputs: [
        document.getElementById('amp-h1'),
        document.getElementById('amp-h2'),
        document.getElementById('amp-h3'),
        document.getElementById('amp-h4'),
        document.getElementById('amp-h5')
    ],
    ampNeg: document.getElementById('amp-neg'),

    transAmp: document.getElementById('trans-amp'),
    transPower: document.getElementById('trans-power'),

    decompCheck: document.getElementById('decomp-check'),
    trajCheck: document.getElementById('traj-check'),
    rotFieldsCheck: document.getElementById('rot-fields-check'),
    extraTrajCheck: document.getElementById('extra-traj-check'),

    canvases: {
        fieldCombined: document.getElementById('field-combined'),
        signalCombined: document.getElementById('signal-combined'),
        fieldClarke: document.getElementById('field-clarke'),
        signalClarke: document.getElementById('signal-clarke')
    }
};

// Contexts
const ctxs = {};
for (const [key, canvas] of Object.entries(els.canvases)) {
    ctxs[key] = canvas.getContext('2d');
    state.viewStates[canvas.id] = { scale: 1.0, offsetX: 0, offsetY: 0 };
}

// Initialization
function init() {
    console.log("Initializing Clarke Web Version...");
    resizeCanvases();
    window.addEventListener('resize', resizeCanvases);

    // Event Listeners
    els.playBtn.addEventListener('click', togglePlay);
    els.resetBtn.addEventListener('click', reset);
    els.slider.addEventListener('input', (e) => updateFrame(parseInt(e.target.value)));
    els.loopCheck.addEventListener('change', (e) => state.loop = e.target.checked);

    // Amplitudes
    els.ampInputs.forEach((input, idx) => {
        input.addEventListener('input', (e) => {
            state.ampPosHarmonics[idx] = parseFloat(e.target.value);
            computeSignals();
            draw();
        });
    });

    els.ampNeg.addEventListener('input', (e) => {
        state.ampNeg = parseFloat(e.target.value);
        computeSignals();
        draw();
    });

    // Transform Type
    const updateTransform = () => {
        state.transformType = els.transAmp.checked ? 'amp' : 'power';
        computeSignals();
        draw();
    };
    els.transAmp.addEventListener('change', updateTransform);
    els.transPower.addEventListener('change', updateTransform);

    // Visualization
    els.decompCheck.addEventListener('change', (e) => { state.decomposition = e.target.checked; draw(); });
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

    // Zoom/Pan
    Object.values(els.canvases).forEach(canvas => {
        canvas.addEventListener('wheel', handleZoom);
        canvas.addEventListener('mousedown', handleMouseDown);
        canvas.addEventListener('mousemove', handleMouseMove);
        canvas.addEventListener('mouseup', handleMouseUp);
        canvas.addEventListener('mouseleave', handleMouseUp);
    });

    computeSignals();
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
    for (const [key, canvas] of Object.entries(els.canvases)) {
        const rect = canvas.parentElement.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;
    }
    draw();
}

// Zoom/Pan Logic (Independent & Adaptive)
function handleZoom(e) {
    e.preventDefault();
    const canvasId = e.target.id;
    const viewState = state.viewStates[canvasId];
    if (!viewState) return;

    const zoomIntensity = 0.1;
    const delta = e.deltaY > 0 ? -zoomIntensity : zoomIntensity;
    const newScale = viewState.scale + delta;
    viewState.scale = Math.min(Math.max(0.1, newScale), 10.0);
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
let signalsPos, signalsNeg, signalsCombined, signalsAlpha, signalsBeta;

function computeSignals() {
    signalsPos = [];
    signalsNeg = [];
    signalsCombined = [];
    signalsAlpha = [];
    signalsBeta = [];

    const k = state.transformType === 'amp' ? 2 / 3 : Math.sqrt(2 / 3);

    for (let i = 0; i < POINTS; i++) {
        const ti = state.t[i];

        // Positive Sequence (Sum of Harmonics)
        let rowPos = [0, 0, 0];
        state.ampPosHarmonics.forEach((amp, idx) => {
            if (amp > 0.001) {
                const h = idx + 1;
                for (let ph = 0; ph < 3; ph++) {
                    rowPos[ph] += amp * Math.cos(h * (OMEGA * ti - ANGLES[ph]));
                }
            }
        });

        // Negative Sequence (Fundamental)
        const rowNeg = ANGLES.map(angle => state.ampNeg * Math.cos(OMEGA * ti + angle));

        // Combined
        const rowComb = rowPos.map((v, idx) => v + rowNeg[idx]);

        signalsPos.push(rowPos);
        signalsNeg.push(rowNeg);
        signalsCombined.push(rowComb);

        // Clarke Transform
        const a = rowComb[0];
        const b = rowComb[1];
        const c = rowComb[2];

        const alpha = k * (a - 0.5 * b - 0.5 * c);
        const beta = k * (Math.sqrt(3) / 2 * b - Math.sqrt(3) / 2 * c);

        signalsAlpha.push(alpha);
        signalsBeta.push(beta);
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
    for (const key in state.viewStates) {
        state.viewStates[key] = { scale: 1.0, offsetX: 0, offsetY: 0 };
    }
    clearTrajectories();
    draw();
}

function clearTrajectories() {
    state.trajPointsCombined = [];
    state.trajPointsExtraPos = [];
    state.trajPointsExtraNeg = [];
    state.trajPointsClarke = [];
}

function updateFrame(frame) {
    state.frame = frame;
    els.timeDisplay.textContent = `Time: ${state.t[frame].toFixed(2)} s`;

    if (state.showTraj) {
        // Combined Trajectory (Resultant of ABC)
        // Note: In phasor view, we usually plot resultant of vectors.
        // For ABC, resultant is sum of vectors.
        const getVecSum = (sigs, frame) => {
            let x = 0, y = 0;
            for (let i = 0; i < 3; i++) {
                x += sigs[frame][i] * Math.cos(ANGLES[i]);
                y += sigs[frame][i] * Math.sin(ANGLES[i]);
            }
            return { x, y };
        };

        const resComb = getVecSum(signalsCombined, frame);
        state.trajPointsCombined.push(resComb);

        // Clarke Trajectory (Alpha, Beta)
        // Alpha on X, Beta on Y
        state.trajPointsClarke.push({ x: signalsAlpha[frame], y: signalsBeta[frame] });

        // Extra Trajectories
        if (state.extraTraj && state.showRotFields) {
            const resPos = getVecSum(signalsPos, frame);
            state.trajPointsExtraPos.push(resPos);
            // Neg is added to Pos
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
    if (!signalsCombined || !signalsCombined.length) return;

    // 1. Combined Field (ABC)
    drawField(ctxs.fieldCombined, els.canvases.fieldCombined.id, signalsCombined, COLORS_POS.concat(COLORS_NEG), state.trajPointsCombined, 'combined');

    // 2. Combined Signals (ABC)
    drawSignals(ctxs.signalCombined, els.canvases.signalCombined.id, signalsCombined, COLORS_POS, 'combined');

    // 3. Clarke Field (Alpha Beta)
    drawField(ctxs.fieldClarke, els.canvases.fieldClarke.id, null, [COLOR_ALPHA, COLOR_BETA], state.trajPointsClarke, 'clarke');

    // 4. Clarke Signals (Alpha Beta)
    drawSignals(ctxs.signalClarke, els.canvases.signalClarke.id, null, [COLOR_ALPHA, COLOR_BETA], 'clarke');
}

function drawGrid(ctx, w, h, cx, cy, baseScale, viewState) {
    ctx.strokeStyle = COLOR_GRID;
    ctx.lineWidth = 1 / viewState.scale;
    ctx.beginPath();

    // Adaptive Step
    let step = baseScale;
    const minSpacing = 40;
    const maxSpacing = 120;
    while (step * viewState.scale < minSpacing) step *= 2;
    while (step * viewState.scale > maxSpacing) step /= 2;

    const s = viewState.scale;
    const ox = viewState.offsetX;
    const oy = viewState.offsetY;

    const xMin = (-ox - w / 2) / s + w / 2;
    const xMax = (w - ox - w / 2) / s + w / 2;
    const yMin = (-oy - h / 2) / s + h / 2;
    const yMax = (h - oy - h / 2) / s + h / 2;

    const iMin = Math.floor((xMin - cx) / step);
    const iMax = Math.ceil((xMax - cx) / step);
    for (let i = iMin; i <= iMax; i++) {
        const x = cx + i * step;
        ctx.moveTo(x, yMin); ctx.lineTo(x, yMax);
    }

    const jMin = Math.floor((yMin - cy) / step);
    const jMax = Math.ceil((yMax - cy) / step);
    for (let j = jMin; j <= jMax; j++) {
        const y = cy + j * step;
        ctx.moveTo(xMin, y); ctx.lineTo(xMax, y);
    }
    ctx.stroke();

    // Axes
    ctx.strokeStyle = COLOR_AXIS;
    ctx.lineWidth = 2 / viewState.scale;
    ctx.beginPath();
    if (cx >= xMin && cx <= xMax) { ctx.moveTo(cx, yMin); ctx.lineTo(cx, yMax); }
    if (cy >= yMin && cy <= yMax) { ctx.moveTo(xMin, cy); ctx.lineTo(xMax, cy); }
    ctx.stroke();
}

function drawField(ctx, canvasId, signals, colors, trajPoints, type) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const viewState = state.viewStates[canvasId];

    ctx.save();
    ctx.clearRect(0, 0, w, h);

    ctx.translate(viewState.offsetX, viewState.offsetY);
    ctx.translate(w / 2, h / 2);
    ctx.scale(viewState.scale, viewState.scale);
    ctx.translate(-w / 2, -h / 2);

    const cx = w / 2;
    const cy = h / 2;
    const baseScale = Math.min(w, h) / 8;

    drawGrid(ctx, w, h, cx, cy, baseScale, viewState);

    const frame = state.frame;
    let vectors = [];

    if (type === 'combined') {
        // ABC Vectors
        // Pos
        const totalPosAmp = state.ampPosHarmonics.reduce((a, b) => a + b, 0);
        if (totalPosAmp >= 0.01) {
            for (let i = 0; i < 3; i++) {
                vectors.push({ x: signalsPos[frame][i] * Math.cos(ANGLES[i]), y: signalsPos[frame][i] * Math.sin(ANGLES[i]), c: COLORS_POS[i] });
            }
        }
        // Neg
        if (state.ampNeg >= 0.01) {
            for (let i = 0; i < 3; i++) {
                vectors.push({ x: signalsNeg[frame][i] * Math.cos(ANGLES[i]), y: signalsNeg[frame][i] * Math.sin(ANGLES[i]), c: COLORS_NEG[i] });
            }
        }
    } else if (type === 'clarke') {
        // Alpha Beta Vectors
        // Alpha on X, Beta on Y
        vectors.push({ x: signalsAlpha[frame], y: 0, c: COLOR_ALPHA });
        vectors.push({ x: 0, y: signalsBeta[frame], c: COLOR_BETA });
    }

    // Draw Vectors
    let currentX = 0;
    let currentY = 0;
    let resX = 0;
    let resY = 0;
    vectors.forEach(v => { resX += v.x; resY += v.y; });

    if (state.decomposition && type === 'combined') {
        vectors.forEach(v => {
            drawArrow(ctx, cx + currentX * baseScale, cy - currentY * baseScale, cx + (currentX + v.x) * baseScale, cy - (currentY + v.y) * baseScale, v.c, 3, false, viewState);
            currentX += v.x;
            currentY += v.y;
        });
        drawArrow(ctx, cx, cy, cx + resX * baseScale, cy - resY * baseScale, COLOR_RES_POS, 4, false, viewState);
    } else {
        vectors.forEach(v => {
            drawArrow(ctx, cx, cy, cx + v.x * baseScale, cy - v.y * baseScale, v.c, 3, false, viewState);
        });
        drawArrow(ctx, cx, cy, cx + resX * baseScale, cy - resY * baseScale, COLOR_RES_POS, 4, false, viewState);
    }

    // Extra Rotating Fields (Combined)
    if (type === 'combined' && state.showRotFields) {
        // Reconstruct Pos Resultant
        let rx_pos = 0, ry_pos = 0;
        for (let i = 0; i < 3; i++) {
            rx_pos += signalsPos[frame][i] * Math.cos(ANGLES[i]);
            ry_pos += signalsPos[frame][i] * Math.sin(ANGLES[i]);
        }
        // Reconstruct Neg Resultant
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
        if (type === 'combined' && state.extraTraj && state.showRotFields) {
            drawTrajectory(ctx, state.trajPointsExtraPos, cx, cy, baseScale, COLOR_RES_POS, true, viewState);
            drawTrajectory(ctx, state.trajPointsExtraNeg, cx, cy, baseScale, COLOR_RES_NEG, true, viewState);
        }
    }

    ctx.restore();
}

function drawSignals(ctx, canvasId, signals, colors, type) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const viewState = state.viewStates[canvasId];

    ctx.save();
    ctx.clearRect(0, 0, w, h);

    ctx.translate(viewState.offsetX, viewState.offsetY);
    ctx.translate(w / 2, h / 2);
    ctx.scale(viewState.scale, viewState.scale);
    ctx.translate(-w / 2, -h / 2);

    const cx = 0;
    const cy = h / 2;
    const xScale = w / (POINTS - 1);
    const yScale = h / 8;

    // Adaptive Grid
    ctx.strokeStyle = COLOR_GRID;
    ctx.lineWidth = 1 / viewState.scale;
    ctx.beginPath();

    const s = viewState.scale;
    const ox = viewState.offsetX;
    const oy = viewState.offsetY;
    const xMin = (-ox - w / 2) / s + w / 2;
    const xMax = (w - ox - w / 2) / s + w / 2;
    const yMin = (-oy - h / 2) / s + h / 2;
    const yMax = (h - oy - h / 2) / s + h / 2;

    let hStep = yScale;
    while (hStep * s < 40) hStep *= 2;
    while (hStep * s > 120) hStep /= 2;
    const jMin = Math.floor((yMin - cy) / hStep);
    const jMax = Math.ceil((yMax - cy) / hStep);
    for (let j = jMin; j <= jMax; j++) {
        const y = cy + j * hStep;
        ctx.moveTo(xMin, y); ctx.lineTo(xMax, y);
    }

    let vStep = xScale * 20;
    while (vStep * s < 40) vStep *= 2;
    while (vStep * s > 120) vStep /= 2;
    const iMin = Math.floor(xMin / vStep);
    const iMax = Math.ceil(xMax / vStep);
    for (let i = iMin; i <= iMax; i++) {
        const x = i * vStep;
        ctx.moveTo(x, yMin); ctx.lineTo(x, yMax);
    }
    ctx.stroke();

    // Axis
    ctx.strokeStyle = COLOR_AXIS;
    ctx.lineWidth = 2 / viewState.scale;
    ctx.beginPath();
    if (cy >= yMin && cy <= yMax) { ctx.moveTo(xMin, cy); ctx.lineTo(xMax, cy); }
    ctx.stroke();

    // Draw Curves
    if (type === 'combined') {
        for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.strokeStyle = colors[i];
            ctx.lineWidth = 2 / viewState.scale;
            for (let j = 0; j < POINTS; j++) {
                const x = j * xScale;
                const y = cy - signals[j][i] * yScale;
                if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
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
    } else if (type === 'clarke') {
        // Alpha
        ctx.beginPath();
        ctx.strokeStyle = COLOR_ALPHA;
        ctx.lineWidth = 2 / viewState.scale;
        for (let j = 0; j < POINTS; j++) {
            const x = j * xScale;
            const y = cy - signalsAlpha[j] * yScale;
            if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        // Alpha Marker
        let mx = state.frame * xScale;
        let my = cy - signalsAlpha[state.frame] * yScale;
        ctx.beginPath(); ctx.fillStyle = COLOR_ALPHA; ctx.arc(mx, my, 4 / viewState.scale, 0, Math.PI * 2); ctx.fill();

        // Beta
        ctx.beginPath();
        ctx.strokeStyle = COLOR_BETA;
        ctx.lineWidth = 2 / viewState.scale;
        for (let j = 0; j < POINTS; j++) {
            const x = j * xScale;
            const y = cy - signalsBeta[j] * yScale;
            if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        // Beta Marker
        mx = state.frame * xScale;
        my = cy - signalsBeta[state.frame] * yScale;
        ctx.beginPath(); ctx.fillStyle = COLOR_BETA; ctx.arc(mx, my, 4 / viewState.scale, 0, Math.PI * 2); ctx.fill();
    }

    ctx.restore();
}

function drawArrow(ctx, x1, y1, x2, y2, color, width = 3, dashed = false, viewState) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width / viewState.scale;
    if (dashed) ctx.setLineDash([5, 5]); else ctx.setLineDash([]);
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.fillStyle = color;
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

// Start
init();
