// Constants
const OMEGA = 2 * Math.PI;
const T_MAX = 2.0;
const POINTS = 200;
const ANGLES = [0, 120 * Math.PI / 180, 240 * Math.PI / 180];

// FFT Constants
const FFT_CYCLES = 100;
const FFT_POINTS = 16384;
const DT = T_MAX / (POINTS - 1);

// Colors
const COLORS_POS = ['#FF5555', '#55FF55', '#5555FF'];
const COLORS_NEG = ['#FF55FF', '#55FFFF', '#FFFF55'];
const COLOR_ALPHA = '#FFA500';
const COLOR_BETA = '#00FFFF';
const COLOR_RES_POS = '#FFFFFF';
const COLOR_RES_NEG = '#AAAAAA';
const COLOR_GRID = '#333333';
const COLOR_AXIS = '#666666';
const COLOR_FFT_STEM = '#007acc';
const DEFAULT_HARM_COLORS = [
    '#55FF55', '#FF55FF', '#FFFF55', '#FF5555', '#55FFFF', '#FFFF55',
    '#5555FF', '#FF00FF', '#FFFF55', '#00FF00', '#00FFFF', '#FFFF55', '#0000FF'
];
const COLOR_NEG_FUND = '#FF55FF';

// State
let state = {
    t: Array.from({ length: POINTS }, (_, i) => i * DT),
    frame: 0,
    isPlaying: false,
    loop: true,
    speedMult: 1.0,

    // Amplitudes
    ampPosHarmonics: [1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    ampNeg: 0.1,

    // Transform Type
    transformType: 'amp',

    // FFT
    fftSignalSelection: 'Complex Vector',
    fftData: { freqs: [], mags: [] },

    // Visualization
    decomposition: true,
    showTraj: true,
    showRotFields: false,
    extraTraj: false,
    rotEachHarm: false,
    harmonicColors: [...DEFAULT_HARM_COLORS],
    negColor: COLOR_NEG_FUND,

    // Trajectory Points
    trajPointsCombined: [],
    trajPointsExtraPos: [],
    trajPointsExtraNeg: [],
    trajPointsClarke: [],

    // Interaction State
    transforms: {}, // { x, y, k } per canvas
    isDragging: false,
    lastMouse: { x: 0, y: 0 },
    activeCanvasId: null,

    // Animation Sequence State
    anim: {
        active: false,
        step: 0,
        sequence: [], // { type, mag, color, idx }
        targetTransform: null, // { x, y, k }
        startTransform: null,
        startTime: 0,
        duration: 1000,
        pauseTime: 0,
        waiting: false
    }
};

// DOM Elements
const els = {
    slider: document.getElementById('time-slider'),
    timeDisplay: document.getElementById('time-display'),
    playBtn: document.getElementById('play-btn'),
    resetBtn: document.getElementById('reset-btn'),
    loopCheck: document.getElementById('loop-check'),
    speedSelect: document.getElementById('speed-select'),
    presetSelect: document.getElementById('preset-select'),
    ampInputs: Array.from({ length: 13 }, (_, i) => document.getElementById(`amp-h${i + 1}`)),
    colorInputs: Array.from({ length: 13 }, (_, i) => document.getElementById(`color-h${i + 1}`)),
    ampNeg: document.getElementById('amp-neg'),
    colorNeg: document.getElementById('color-neg'),
    transAmp: document.getElementById('trans-amp'),
    transPower: document.getElementById('trans-power'),
    fftSelect: document.getElementById('fft-signal-select'),
    decompCheck: document.getElementById('decomp-check'),
    trajCheck: document.getElementById('traj-check'),
    rotFieldsCheck: document.getElementById('rot-fields-check'),
    extraTrajCheck: document.getElementById('extra-traj-check'),
    rotHarmCheck: document.getElementById('rot-harm-check'),
    showHarmBtn: document.getElementById('show-harm-btn'),
    overlay: document.getElementById('overlay'),
    canvases: {
        fieldCombined: document.getElementById('field-combined'),
        signalCombined: document.getElementById('signal-combined'),
        fieldClarke: document.getElementById('field-clarke'),
        signalClarke: document.getElementById('signal-clarke'),
        signalFFT: document.getElementById('signal-fft')
    }
};

const ctxs = {};
for (const [key, canvas] of Object.entries(els.canvases)) {
    ctxs[key] = canvas.getContext('2d');
    // Initial Transform: Centered, Scale 1
    state.transforms[canvas.id] = { x: 0, y: 0, k: 1.0 };
}

// --- Initialization ---
function init() {
    console.log("Initializing Clarke FFT Refactored...");
    resizeCanvases();
    window.addEventListener('resize', resizeCanvases);

    // Controls
    els.playBtn.addEventListener('click', () => {
        state.isPlaying = !state.isPlaying;
        els.playBtn.textContent = state.isPlaying ? "Pause" : "Play";
    });
    els.resetBtn.addEventListener('click', reset);
    els.slider.addEventListener('input', (e) => {
        state.frame = parseInt(e.target.value);
        updateTimeDisplay();
    });
    els.loopCheck.addEventListener('change', (e) => state.loop = e.target.checked);
    els.speedSelect.addEventListener('change', (e) => state.speedMult = parseFloat(e.target.value));
    els.presetSelect.addEventListener('change', (e) => applyPreset(e.target.value));

    // Inputs
    els.ampInputs.forEach((input, idx) => {
        input.addEventListener('input', (e) => {
            els.presetSelect.value = "Custom";
            state.ampPosHarmonics[idx] = parseFloat(e.target.value) || 0;
            computeSignals();
        });
    });
    els.ampNeg.addEventListener('input', (e) => {
        els.presetSelect.value = "Custom";
        state.ampNeg = parseFloat(e.target.value) || 0;
        computeSignals();
    });
    els.colorInputs.forEach((input, idx) => {
        input.addEventListener('input', (e) => state.harmonicColors[idx] = e.target.value);
    });
    els.colorNeg.addEventListener('input', (e) => state.negColor = e.target.value);

    // Toggles
    const updateTransform = () => {
        state.transformType = els.transAmp.checked ? 'amp' : 'power';
        computeSignals();
    };
    els.transAmp.addEventListener('change', updateTransform);
    els.transPower.addEventListener('change', updateTransform);
    els.fftSelect.addEventListener('change', (e) => {
        state.fftSignalSelection = e.target.value;
        computeFFT();
    });
    els.decompCheck.addEventListener('change', (e) => state.decomposition = e.target.checked);
    els.trajCheck.addEventListener('change', (e) => {
        state.showTraj = e.target.checked;
        if (!state.showTraj) clearTrajectories();
        updateExtraTrajState();
    });
    els.rotFieldsCheck.addEventListener('change', (e) => {
        state.showRotFields = e.target.checked;
        updateExtraTrajState();
    });
    els.extraTrajCheck.addEventListener('change', (e) => {
        state.extraTraj = e.target.checked;
        if (!state.extraTraj) {
            state.trajPointsExtraPos = [];
            state.trajPointsExtraNeg = [];
        }
    });
    els.rotHarmCheck.addEventListener('change', (e) => {
        state.rotEachHarm = e.target.checked;
        els.rotFieldsCheck.disabled = state.rotEachHarm;
        els.decompCheck.disabled = state.rotEachHarm;
        els.showHarmBtn.disabled = !state.rotEachHarm;
        if (state.rotEachHarm) {
            state.showRotFields = false;
            els.rotFieldsCheck.checked = false;
        } else {
            els.rotFieldsCheck.disabled = false;
            els.decompCheck.disabled = false;
        }
    });
    els.showHarmBtn.addEventListener('click', startHarmonicsSequence);

    // Mouse Interaction
    Object.values(els.canvases).forEach(canvas => {
        canvas.addEventListener('wheel', handleZoom, { passive: false });
        canvas.addEventListener('mousedown', handleMouseDown);
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    });

    computeSignals();
    requestAnimationFrame(gameLoop);
}

// --- Interaction Logic ---
function handleZoom(e) {
    e.preventDefault();
    const canvasId = e.target.id;
    const t = state.transforms[canvasId];
    if (!t) return;

    // Zoom towards mouse pointer
    const rect = e.target.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Convert mouse to world space
    // world = (screen - translate) / scale
    const wx = (mx - t.x) / t.k;
    const wy = (my - t.y) / t.k;

    // Update scale
    const zoomIntensity = 0.1;
    const delta = -Math.sign(e.deltaY) * zoomIntensity;
    const factor = Math.exp(delta);
    let newK = t.k * factor;
    newK = Math.max(0.1, Math.min(newK, 50.0)); // Clamp

    // Update translation to keep world point under mouse
    // translate = screen - world * newScale
    t.x = mx - wx * newK;
    t.y = my - wy * newK;
    t.k = newK;
}

function handleMouseDown(e) {
    state.isDragging = true;
    state.activeCanvasId = e.target.id;
    state.lastMouse = { x: e.clientX, y: e.clientY };
}

function handleMouseMove(e) {
    if (!state.isDragging || !state.activeCanvasId) return;
    const t = state.transforms[state.activeCanvasId];

    const dx = e.clientX - state.lastMouse.x;
    const dy = e.clientY - state.lastMouse.y;

    t.x += dx;
    t.y += dy;

    state.lastMouse = { x: e.clientX, y: e.clientY };
}

function handleMouseUp() {
    state.isDragging = false;
    state.activeCanvasId = null;
}

function resizeCanvases() {
    for (const [key, canvas] of Object.entries(els.canvases)) {
        const rect = canvas.parentElement.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;

        // Center view if first load or reset
        if (state.transforms[canvas.id].k === 1.0 && state.transforms[canvas.id].x === 0) {
            if (key.includes('signal') && !key.includes('FFT')) {
                // Signals: Start from left (padding)
                state.transforms[canvas.id].x = 40;
                state.transforms[canvas.id].y = rect.height / 2;
            } else {
                // Fields and FFT: Center
                state.transforms[canvas.id].x = rect.width / 2;
                state.transforms[canvas.id].y = rect.height / 2;
            }
        }
    }
    // Resize Overlay
    const overlayRect = els.overlay.parentElement.getBoundingClientRect();
    els.overlay.setAttribute('width', overlayRect.width);
    els.overlay.setAttribute('height', overlayRect.height);
}

// --- Main Game Loop ---
let lastTime = 0;
let lastSimTime = 0;

function gameLoop(timestamp) {
    const dt = timestamp - lastTime;
    lastTime = timestamp;

    // 1. Update Simulation
    if (state.isPlaying && !state.anim.active) {
        const delay = 50 / (state.speedMult || 1.0);
        if (timestamp - lastSimTime >= delay) {
            lastSimTime = timestamp;
            let next = state.frame + 1;
            if (next >= POINTS) {
                if (state.loop) {
                    next = 0;
                    clearTrajectories();
                } else {
                    state.isPlaying = false;
                    els.playBtn.textContent = "Play";
                    next = POINTS - 1;
                }
            }
            state.frame = next;
            els.slider.value = state.frame;
            updateTimeDisplay();
            updateTrajectories();
        }
    } else {
        // Keep sim time synced to avoid jump when resuming
        lastSimTime = timestamp;
    }

    // 2. Update Animation (Show My Harmonics)
    if (state.anim.active) {
        updateAnimation(timestamp);
    }

    // 3. Render
    render();

    requestAnimationFrame(gameLoop);
}

function updateAnimation(now) {
    const anim = state.anim;
    if (anim.waiting) {
        if (now - anim.pauseTime > 1000) {
            anim.waiting = false;
            anim.step++;
            anim.startTime = now;
            setupNextAnimStep();
        }
        return;
    }

    if (!anim.targetTransform) return;

    const elapsed = now - anim.startTime;
    const t = Math.min(elapsed / anim.duration, 1.0);
    // Cubic Ease
    const ease = 1 - Math.pow(1 - t, 3);

    const start = anim.startTransform;
    const target = anim.targetTransform;
    const current = state.transforms[els.canvases.fieldCombined.id];

    current.k = start.k + (target.k - start.k) * ease;
    current.x = start.x + (target.x - start.x) * ease;
    current.y = start.y + (target.y - start.y) * ease;

    if (t >= 1.0) {
        // Step Complete
        anim.waiting = true;
        anim.pauseTime = now;
        // Draw Arrow (handled in render)
    }
}

function render() {
    // Clear all
    Object.values(ctxs).forEach(ctx => ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height));
    els.overlay.innerHTML = ''; // Clear SVG overlay

    if (!signalsCombined || !signalsCombined.length) return;

    // Draw Plots
    drawField(ctxs.fieldCombined, els.canvases.fieldCombined.id, signalsCombined, COLORS_POS.concat(COLORS_NEG), state.trajPointsCombined, 'combined');
    drawSignals(ctxs.signalCombined, els.canvases.signalCombined.id, signalsCombined, COLORS_POS, 'combined');
    drawField(ctxs.fieldClarke, els.canvases.fieldClarke.id, null, [COLOR_ALPHA, COLOR_BETA], state.trajPointsClarke, 'clarke');
    drawSignals(ctxs.signalClarke, els.canvases.signalClarke.id, null, [COLOR_ALPHA, COLOR_BETA], 'clarke');
    drawFFT(ctxs.signalFFT, els.canvases.signalFFT.id);

    // Draw Animation Overlay
    if (state.anim.active && state.anim.waiting) {
        const stepIdx = state.anim.step;
        if (stepIdx < state.anim.sequence.length) {
            const item = state.anim.sequence[stepIdx];
            // We need to calculate the vector position again to draw the arrow
            // This is a bit inefficient but safe
            const vec = calculateVectorForAnim(stepIdx);
            if (vec) {
                drawOverlayArrow(vec.startX, vec.startY, vec.vx, vec.vy, item.color);
            }
        }
    }
}

function drawField(ctx, id, signals, colors, trajPoints, type) {
    const t = state.transforms[id];
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;

    ctx.save();
    // Apply Transform
    ctx.translate(t.x, t.y);
    ctx.scale(t.k, t.k);

    // Grid
    drawGrid(ctx, w, h, t);

    // Base Scale for vectors (arbitrary visual scale)
    const baseScale = Math.min(w, h) / 8;
    const cx = 0; // World origin is 0,0
    const cy = 0;

    // Vectors
    const frame = state.frame;
    let vectors = [];

    if (type === 'combined') {
        if (state.rotEachHarm) {
            drawRotatingHarmonics(ctx, baseScale);
            // Trajectories handled separately
        } else {
            // Standard Mode: Use Pulsating Phase Vectors (matches trajectory scaling)
            const totalPosAmp = state.ampPosHarmonics.reduce((a, b) => a + b, 0);
            if (totalPosAmp >= 0.01) {
                for (let i = 0; i < 3; i++) {
                    vectors.push({ x: signalsPos[frame][i] * Math.cos(ANGLES[i]), y: signalsPos[frame][i] * Math.sin(ANGLES[i]), c: COLORS_POS[i] });
                }
            }
            if (state.ampNeg >= 0.01) {
                for (let i = 0; i < 3; i++) {
                    vectors.push({ x: signalsNeg[frame][i] * Math.cos(ANGLES[i]), y: signalsNeg[frame][i] * Math.sin(ANGLES[i]), c: COLORS_NEG[i] });
                }
            }

            let curX = 0;
            let curY = 0;
            let resX = 0;
            let resY = 0;

            // Calculate Resultant
            vectors.forEach(v => { resX += v.x; resY += v.y; });

            if (state.decomposition) {
                // Tip-to-tail
                vectors.forEach(v => {
                    drawVector(ctx, curX * baseScale, -curY * baseScale, (curX + v.x) * baseScale, -(curY + v.y) * baseScale, v.c, 2);
                    curX += v.x;
                    curY += v.y;
                });
                // Resultant
                drawVector(ctx, 0, 0, curX * baseScale, -curY * baseScale, COLOR_RES_POS, 4);
            } else {
                // Center Origin
                vectors.forEach(v => {
                    drawVector(ctx, 0, 0, v.x * baseScale, -v.y * baseScale, v.c, 2);
                });
                // Resultant
                drawVector(ctx, 0, 0, resX * baseScale, -resY * baseScale, COLOR_RES_POS, 4);
            }

            // Rotating Fields (Pos/Neg Sequence Resultants)
            if (state.showRotFields) {
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

                drawVector(ctx, 0, 0, rx_pos * baseScale, -ry_pos * baseScale, COLOR_RES_POS, 2); // Pos
                drawVector(ctx, rx_pos * baseScale, -ry_pos * baseScale, (rx_pos + rx_neg) * baseScale, -(ry_pos + ry_neg) * baseScale, COLOR_RES_NEG, 2); // Neg
            }
        }
    } else if (type === 'clarke') {
        const alpha = signalsAlpha[frame];
        const beta = signalsBeta[frame];

        if (state.decomposition) {
            // Tip-to-tail
            drawVector(ctx, 0, 0, alpha * baseScale, 0, COLOR_ALPHA, 2);
            drawVector(ctx, alpha * baseScale, 0, alpha * baseScale, -beta * baseScale, COLOR_BETA, 2);
        } else {
            // Origin-based
            drawVector(ctx, 0, 0, alpha * baseScale, 0, COLOR_ALPHA, 2);
            drawVector(ctx, 0, 0, 0, -beta * baseScale, COLOR_BETA, 2);
        }
        // Resultant
        drawVector(ctx, 0, 0, alpha * baseScale, -beta * baseScale, COLOR_RES_POS, 4);
    }

    // Trajectories
    if (state.showTraj) {
        drawTrajectory(ctx, trajPoints, baseScale, COLOR_RES_POS);
        if (type === 'combined' && state.extraTraj && state.showRotFields && !state.rotEachHarm) {
            drawTrajectory(ctx, state.trajPointsExtraPos, baseScale, COLOR_RES_POS, true);
            drawTrajectory(ctx, state.trajPointsExtraNeg, baseScale, COLOR_RES_NEG, true);
        }
    }

    ctx.restore();
}

function drawRotatingHarmonics(ctx, scale) {
    const frame = state.frame;
    if (!state.vectorChains || !state.vectorChains[frame]) return;

    const chain = state.vectorChains[frame];
    let curX = 0, curY = 0;

    chain.forEach(vec => {
        // Draw vector from its stored start/end points
        // Note: Y is inverted for drawing
        drawVector(ctx, vec.x1 * scale, -vec.y1 * scale, vec.x2 * scale, -vec.y2 * scale, vec.color, 2);
        // Update cursor for Resultant (should match vec.x2, vec.y2)
        curX = vec.x2;
        curY = vec.y2;
    });

    // Draw Resultant (Tip of the chain)
    drawVector(ctx, 0, 0, curX * scale, -curY * scale, COLOR_RES_POS, 4);
}

function drawVector(ctx, x1, y1, x2, y2, color, width) {
    const k = state.transforms[els.canvases.fieldCombined.id].k;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = color;
    ctx.lineWidth = width / k;
    ctx.stroke();

    // Circle Tip
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc(x2, y2, (width * 1.5) / k, 0, Math.PI * 2);
    ctx.fill();
}

function drawGrid(ctx, w, h, t) {
    // Calculate visible world bounds
    // Screen (0,0) -> World (-t.x/k, -t.y/k)
    // Screen (w,h) -> World ((w-t.x)/k, (h-t.y)/k)
    const left = -t.x / t.k;
    const top = -t.y / t.k;
    const right = (w - t.x) / t.k;
    const bottom = (h - t.y) / t.k;

    // Determine grid step
    const baseScale = Math.min(w, h) / 8;
    let step = baseScale;
    const minScreenSpacing = 50;
    while (step * t.k < minScreenSpacing) step *= 2;

    ctx.strokeStyle = COLOR_GRID;
    ctx.lineWidth = 1 / t.k;
    ctx.beginPath();

    // Vertical lines
    const startX = Math.floor(left / step) * step;
    for (let x = startX; x < right; x += step) {
        ctx.moveTo(x, top); ctx.lineTo(x, bottom);
    }
    // Horizontal lines
    const startY = Math.floor(top / step) * step;
    for (let y = startY; y < bottom; y += step) {
        ctx.moveTo(left, y); ctx.lineTo(right, y);
    }
    ctx.stroke();

    // Axes
    ctx.strokeStyle = COLOR_AXIS;
    ctx.lineWidth = 2 / t.k;
    ctx.beginPath();
    ctx.moveTo(left, 0); ctx.lineTo(right, 0);
    ctx.moveTo(0, top); ctx.lineTo(0, bottom);
    ctx.stroke();
}

function drawSignals(ctx, id, signals, colors, type) {
    const t = state.transforms[id];
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;

    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.scale(t.k, t.k);

    drawGrid(ctx, w, h, t); // Reuse grid logic

    // Signal Scaling
    // X: Time (0 to 2s) mapped to width
    // Y: Amplitude mapped to height/8
    const xScale = w / (POINTS - 1); // This is in "world" units if we treat world width = w
    // Actually, let's define world space for signals:
    // X: 0 to w
    // Y: 0 is center

    // We need to map signal index to world X
    const yScale = h / 8;

    if (type === 'combined') {
        for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.strokeStyle = colors[i];
            ctx.lineWidth = 2 / t.k;
            for (let j = 0; j < POINTS; j++) {
                const x = j * xScale;
                const y = -signals[j][i] * yScale; // Y up is negative in canvas
                if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
            // Marker
            const mx = state.frame * xScale;
            const my = -signals[state.frame][i] * yScale;
            ctx.fillStyle = colors[i];
            ctx.beginPath(); ctx.arc(mx, my, 4 / t.k, 0, Math.PI * 2); ctx.fill();
        }
    } else if (type === 'clarke') {
        // Alpha
        ctx.beginPath(); ctx.strokeStyle = COLOR_ALPHA; ctx.lineWidth = 2 / t.k;
        for (let j = 0; j < POINTS; j++) {
            const x = j * xScale;
            const y = -signalsAlpha[j] * yScale;
            if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        // Beta
        ctx.beginPath(); ctx.strokeStyle = COLOR_BETA; ctx.lineWidth = 2 / t.k;
        for (let j = 0; j < POINTS; j++) {
            const x = j * xScale;
            const y = -signalsBeta[j] * yScale;
            if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }

    ctx.restore();
}

function drawFFT(ctx, id) {
    const t = state.transforms[id];
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;

    ctx.save();
    ctx.clearRect(0, 0, w, h);

    ctx.translate(t.x, t.y);
    ctx.scale(t.k, t.k);

    // Axis Setup
    const xRange = 27; // -13.5 to 13.5
    const xScale = w / xRange;
    const yScale = h * 0.8;
    const cx = 0; // Center in transformed world
    const cy = h * 0.4; // Offset slightly down

    // Auto-scale Y
    let maxMag = 1.0;
    if (state.fftData.mags.length > 0) {
        const peak = Math.max(...state.fftData.mags);
        if (peak > 1.0) maxMag = peak * 1.1;
    }
    const yFactor = yScale / maxMag;

    // Grid
    ctx.strokeStyle = COLOR_GRID;
    ctx.lineWidth = 1 / t.k;
    ctx.beginPath();

    // X Grid
    for (let i = -13; i <= 13; i++) {
        const x = cx + i * xScale;
        ctx.moveTo(x, cy); ctx.lineTo(x, cy - maxMag * yFactor);
    }
    // Y Grid
    for (let val = 0; val <= maxMag; val += 0.1) {
        const y = cy - val * yFactor;
        ctx.moveTo(cx - 13.5 * xScale, y); ctx.lineTo(cx + 13.5 * xScale, y);
    }
    ctx.stroke();

    // Axes
    ctx.strokeStyle = COLOR_AXIS;
    ctx.lineWidth = 2 / t.k;
    ctx.beginPath();
    ctx.moveTo(cx - 13.5 * xScale, cy); ctx.lineTo(cx + 13.5 * xScale, cy); // X Axis
    ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - maxMag * yFactor); // Y Axis
    ctx.stroke();

    // Labels
    ctx.fillStyle = COLOR_AXIS;
    ctx.font = `${12 / t.k}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    // X Labels
    for (let i = -13; i <= 13; i++) {
        const x = cx + i * xScale;
        ctx.fillText(i.toString(), x, cy + 5 / t.k);
    }

    // Y Labels
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let val = 0; val <= maxMag; val += 0.2) {
        if (val === 0) continue;
        const y = cy - val * yFactor;
        ctx.fillText(val.toFixed(1), cx - 5 / t.k, y);
    }

    // Stems
    const { freqs, mags } = state.fftData;
    for (let i = 0; i < freqs.length; i++) {
        const f = freqs[i];
        const m = mags[i];
        const x = cx + f * xScale;
        const y = cy - m * yFactor;

        let color = COLOR_FFT_STEM;
        const harm = Math.round(Math.abs(f));
        if (Math.abs(Math.abs(f) - harm) < 0.2 && harm >= 1 && harm <= 13) {
            if (f > 0 && harm % 3 === 1) color = state.harmonicColors[harm - 1];
            else if (f < 0 && harm % 3 === 2) color = state.harmonicColors[harm - 1];
            else if (f < 0 && harm === 1) color = state.negColor;
        }

        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2 / t.k;
        ctx.moveTo(x, cy); ctx.lineTo(x, y);
        ctx.stroke();

        ctx.beginPath();
        ctx.fillStyle = color;
        ctx.arc(x, y, 4 / t.k, 0, Math.PI * 2);
        ctx.fill();

        // Highlight if active in animation
        if (state.anim.active && state.anim.step < state.anim.sequence.length) {
            const item = state.anim.sequence[state.anim.step];
            let isMatch = false;

            if (item.type === 'H1+') {
                if (Math.abs(f - 1.0) < 0.2) isMatch = true;
            } else if (item.type === 'Neg') {
                if (Math.abs(f - (-1.0)) < 0.2) isMatch = true;
            } else {
                const k = item.idx + 1;
                const isPos = (k % 3 === 1);
                const targetF = isPos ? k : -k;
                if (Math.abs(f - targetF) < 0.2) isMatch = true;
            }

            if (isMatch) {
                ctx.beginPath();
                ctx.strokeStyle = color;
                ctx.lineWidth = 4 / t.k;
                ctx.arc(x, y, 10 / t.k, 0, Math.PI * 2);
                ctx.stroke();
            }
        }
    }

    ctx.restore();
}

function drawTrajectory(ctx, points, scale, color, dashed = false) {
    if (!points.length) return;
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 / state.transforms[els.canvases.fieldCombined.id].k;
    if (dashed) ctx.setLineDash([5, 5]);

    points.forEach((p, i) => {
        const x = p.x * scale;
        const y = -p.y * scale;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
}

function drawOverlayArrow(x, y, vx, vy, color) {
    // Map world coordinates to screen coordinates for SVG
    const canvas = els.canvases.fieldCombined;
    const t = state.transforms[canvas.id];
    const w = canvas.width;
    const h = canvas.height;
    const baseScale = Math.min(w, h) / 8;

    // World Coords
    const wx1 = x * baseScale;
    const wy1 = -y * baseScale;
    const wx2 = (x + vx) * baseScale;
    const wy2 = -(y + vy) * baseScale;

    // Screen Coords = world * k + translate
    const sx1 = wx1 * t.k + t.x;
    const sy1 = wy1 * t.k + t.y;
    const sx2 = wx2 * t.k + t.x;
    const sy2 = wy2 * t.k + t.y;

    // Adjust for overlay position (relative to parent)
    const canvasRect = canvas.getBoundingClientRect();
    const overlayRect = els.overlay.getBoundingClientRect();
    const dx = canvasRect.left - overlayRect.left;
    const dy = canvasRect.top - overlayRect.top;

    const x1 = sx1 + dx;
    const y1 = sy1 + dy;
    const x2 = sx2 + dx;
    const y2 = sy2 + dy;

    // SVG
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", x1); line.setAttribute("y1", y1);
    line.setAttribute("x2", x2); line.setAttribute("y2", y2);
    line.setAttribute("stroke", color);
    line.setAttribute("stroke-width", 4);

    const head = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const headLen = 15;
    const hx1 = x2 - headLen * Math.cos(angle - Math.PI / 6);
    const hy1 = y2 - headLen * Math.sin(angle - Math.PI / 6);
    const hx2 = x2 - headLen * Math.cos(angle + Math.PI / 6);
    const hy2 = y2 - headLen * Math.sin(angle + Math.PI / 6);
    head.setAttribute("points", `${x2},${y2} ${hx1},${hy1} ${hx2},${hy2}`);
    head.setAttribute("fill", color);

    els.overlay.appendChild(line);
    els.overlay.appendChild(head);
}

// --- Animation Logic ---
function startHarmonicsSequence() {
    if (!state.rotEachHarm) return;

    state.wasPlaying = state.isPlaying;
    state.isPlaying = false;
    els.playBtn.textContent = "Play";

    state.anim.active = true;
    state.anim.step = 0;
    state.anim.sequence = [];

    // Build Sequence
    if (state.ampPosHarmonics[0] > 0.001) state.anim.sequence.push({ type: 'H1+', mag: state.ampPosHarmonics[0], color: state.harmonicColors[0], idx: 0 });
    if (state.ampNeg > 0.001) state.anim.sequence.push({ type: 'Neg', mag: state.ampNeg, color: state.negColor, idx: -1 });
    for (let k = 2; k <= 13; k++) {
        if (state.ampPosHarmonics[k - 1] > 0.001 && k % 3 !== 0) {
            state.anim.sequence.push({ type: `H${k}`, mag: state.ampPosHarmonics[k - 1], color: state.harmonicColors[k - 1], idx: k - 1 });
        }
    }

    if (state.anim.sequence.length === 0) {
        endHarmonicsSequence();
        return;
    }

    setupNextAnimStep();
}

function setupNextAnimStep() {
    if (state.anim.step >= state.anim.sequence.length) {
        endHarmonicsSequence();
        return;
    }

    const item = state.anim.sequence[state.anim.step];
    const vec = calculateVectorForAnim(state.anim.step);

    // Focus on this vector
    // Target: Center the vector in the view, zoom in
    const canvas = els.canvases.fieldCombined;
    const w = canvas.width;
    const h = canvas.height;
    const baseScale = Math.min(w, h) / 8;

    // Vector Center in World Coords
    const wx = (vec.startX + vec.vx / 2) * baseScale;
    const wy = -(vec.startY + vec.vy / 2) * baseScale; // Y flip

    // Target Scale
    const mag = Math.sqrt(vec.vx * vec.vx + vec.vy * vec.vy);
    let targetK = 8 / (3 * mag);
    targetK = Math.max(1.0, Math.min(targetK, 10.0));

    // Target Translation: Center (wx, wy) on screen center (w/2, h/2)
    // w/2 = wx * k + tx  => tx = w/2 - wx * k
    const targetX = w / 2 - wx * targetK;
    const targetY = h / 2 - wy * targetK;

    state.anim.startTransform = { ...state.transforms[canvas.id] };
    state.anim.targetTransform = { x: targetX, y: targetY, k: targetK };
    state.anim.startTime = performance.now();
    state.anim.waiting = false;
}

function calculateVectorForAnim(stepIdx) {
    const frame = state.frame;
    if (!state.vectorChains || !state.vectorChains[frame]) return null;

    const chain = state.vectorChains[frame];
    if (stepIdx < 0 || stepIdx >= chain.length) return null;

    const vec = chain[stepIdx];
    // vec has x1, y1 (start), x2, y2 (end), vx, vy (components)
    // These are already scaled by s=1.5 in computeSignals
    return {
        startX: vec.x1,
        startY: vec.y1,
        vx: vec.vx,
        vy: vec.vy
    };
}

function endHarmonicsSequence() {
    state.anim.active = false;
    els.overlay.innerHTML = '';

    // Restore View (Optional: Reset to center or keep last view)
    // Let's reset to center for cleanliness
    const canvas = els.canvases.fieldCombined;
    state.transforms[canvas.id] = { x: canvas.width / 2, y: canvas.height / 2, k: 1.0 };

    if (state.wasPlaying) {
        state.isPlaying = true;
        els.playBtn.textContent = "Pause";
    }
}

// --- Math Helpers (Copied from original) ---
let signalsPos, signalsNeg, signalsCombined, signalsAlpha, signalsBeta;

function computeSignals() {
    signalsPos = []; signalsNeg = []; signalsCombined = []; signalsAlpha = []; signalsBeta = [];

    // Clear and Pre-calculate Trajectories and Chains
    state.trajPointsCombined = [];
    state.trajPointsClarke = [];
    state.trajPointsExtraPos = [];
    state.trajPointsExtraNeg = [];
    state.vectorChains = []; // New: Store vector data for each frame

    const k = state.transformType === 'amp' ? 2 / 3 : Math.sqrt(2 / 3);
    const s = 1.5; // Scale factor for vector sum trajectory

    for (let i = 0; i < POINTS; i++) {
        const ti = state.t[i];
        const { rowComb, alpha, beta, rowPos, rowNeg } = computeSample(ti, k);
        signalsPos.push(rowPos);
        signalsNeg.push(rowNeg);
        signalsCombined.push(rowComb);
        signalsAlpha.push(alpha);
        signalsBeta.push(beta);

        const chain = [];
        let cx = 0;
        let cy = 0;

        // H1
        if (state.ampPosHarmonics[0] > 0.001) {
            const mag = state.ampPosHarmonics[0] * s;
            const ang = OMEGA * ti;
            const vx = mag * Math.cos(ang);
            const vy = mag * Math.sin(ang);
            chain.push({ x1: cx, y1: cy, x2: cx + vx, y2: cy + vy, color: state.harmonicColors[0], mag: mag, vx: vx, vy: vy, name: 'H1' });
            cx += vx; cy += vy;
        }
        // Neg
        if (state.ampNeg > 0.001) {
            const mag = state.ampNeg * s;
            const ang = -OMEGA * ti;
            const vx = mag * Math.cos(ang);
            const vy = mag * Math.sin(ang);
            chain.push({ x1: cx, y1: cy, x2: cx + vx, y2: cy + vy, color: state.negColor, mag: mag, vx: vx, vy: vy, name: 'Neg' });
            cx += vx; cy += vy;
        }





        // Harmonics
        for (let h = 2; h <= 13; h++) {
            const amp = state.ampPosHarmonics[h - 1];
            if (amp < 0.001 || h % 3 === 0) continue;
            const isPos = (h % 3 === 1);
            const ang = isPos ? h * OMEGA * ti : -h * OMEGA * ti;
            const vx = amp * s * Math.cos(ang);
            const vy = amp * s * Math.sin(ang);
            chain.push({ x1: cx, y1: cy, x2: cx + vx, y2: cy + vy, color: state.harmonicColors[h - 1], mag: amp * s, vx: vx, vy: vy, name: `H${h}` });
            cx += vx; cy += vy;
        }

        state.vectorChains.push(chain);
        state.trajPointsCombined.push({ x: cx, y: cy });

        // Clarke
        state.trajPointsClarke.push({ x: alpha, y: beta });

        // Extra
        if (state.ampPosHarmonics[0] > 0.001) {
            const mag = state.ampPosHarmonics[0] * s;
            const ang = OMEGA * ti;
            state.trajPointsExtraPos.push({ x: mag * Math.cos(ang), y: mag * Math.sin(ang) });
        } else {
            state.trajPointsExtraPos.push({ x: 0, y: 0 });
        }
        state.trajPointsExtraNeg.push({ x: cx, y: cy }); // Use total for neg overlay
    }
    computeFFT();
}

// updateTrajectories removed (pre-calculated)
function updateTrajectories() { }

function clearTrajectories() {
    // No-op, handled in computeSignals
}

function computeSample(ti, k) {
    let rowPos = [0, 0, 0];
    state.ampPosHarmonics.forEach((amp, idx) => {
        if (amp > 0.001) {
            const h = idx + 1;
            for (let ph = 0; ph < 3; ph++) {
                rowPos[ph] += amp * Math.cos(h * (OMEGA * ti - ANGLES[ph]));
            }
        }
    });
    const rowNeg = ANGLES.map(angle => state.ampNeg * Math.cos(OMEGA * ti + angle));
    const rowComb = rowPos.map((v, idx) => v + rowNeg[idx]);
    const a = rowComb[0];
    const b = rowComb[1];
    const c = rowComb[2];
    const alpha = k * (a - 0.5 * b - 0.5 * c);
    const beta = k * (Math.sqrt(3) / 2 * b - Math.sqrt(3) / 2 * c);
    return { rowComb, alpha, beta, rowPos, rowNeg };
}

function computeFFT() {
    const N = FFT_POINTS;
    const signalReal = new Float32Array(N);
    const signalImag = new Float32Array(N);
    const k = state.transformType === 'amp' ? 2 / 3 : Math.sqrt(2 / 3);
    const selection = state.fftSignalSelection;

    // Window
    const a0 = 0.21557895; const a1 = 0.41663158; const a2 = 0.277263158; const a3 = 0.083578947; const a4 = 0.006947368;
    const window = new Float32Array(N);
    let windowSum = 0;
    for (let i = 0; i < N; i++) {
        const term1 = a1 * Math.cos(2 * Math.PI * i / (N - 1));
        const term2 = a2 * Math.cos(4 * Math.PI * i / (N - 1));
        const term3 = a3 * Math.cos(6 * Math.PI * i / (N - 1));
        const term4 = a4 * Math.cos(8 * Math.PI * i / (N - 1));
        window[i] = a0 - term1 + term2 - term3 + term4;
        windowSum += window[i];
    }

    for (let i = 0; i < N; i++) {
        const ti = i * DT;
        const { rowComb, alpha, beta } = computeSample(ti, k);
        let valReal = 0, valImag = 0;
        if (selection === "Phase A") valReal = rowComb[0];
        else if (selection === "Phase B") valReal = rowComb[1];
        else if (selection === "Phase C") valReal = rowComb[2];
        else if (selection === "Alpha") valReal = alpha;
        else if (selection === "Beta") valReal = beta;
        else if (selection === "Complex Vector") { valReal = alpha; valImag = beta; }
        signalReal[i] = valReal * window[i];
        signalImag[i] = valImag * window[i];
    }

    transform(signalReal, signalImag);

    const mags = [];
    const freqs = [];
    for (let i = 0; i < N; i++) {
        let freq = 0, mag = 0;
        if (i < N / 2) { freq = i / (N * DT); mag = Math.sqrt(signalReal[i] ** 2 + signalImag[i] ** 2); }
        else { freq = (i - N) / (N * DT); mag = Math.sqrt(signalReal[i] ** 2 + signalImag[i] ** 2); }
        mag /= windowSum;
        if (freq >= -13.5 && freq <= 13.5) { freqs.push(freq); mags.push(mag); }
    }

    // Sort and Filter
    const combined = freqs.map((f, i) => ({ f, m: mags[i] }));
    combined.sort((a, b) => a.f - b.f);
    const filteredFreqs = [], filteredMags = [];
    for (let i = 0; i < combined.length; i++) {
        const m = combined[i].m;
        if (m > 0.004) {
            const prev = i > 0 ? combined[i - 1].m : 0;
            const next = i < combined.length - 1 ? combined[i + 1].m : 0;
            if (m > prev && m > next) { filteredFreqs.push(combined[i].f); filteredMags.push(m); }
        }
    }
    state.fftData = { freqs: filteredFreqs, mags: filteredMags };
}

function transform(real, imag) {
    const n = real.length;
    if (n <= 1) return;
    let i = 0;
    for (let j = 0; j < n - 1; j++) {
        if (j < i) { [real[j], real[i]] = [real[i], real[j]];[imag[j], imag[i]] = [imag[i], imag[j]]; }
        let k = n >> 1;
        while (k <= i) { i -= k; k >>= 1; }
        i += k;
    }
    for (let len = 2; len <= n; len <<= 1) {
        const halfLen = len >> 1;
        const angle = -2 * Math.PI / len;
        const wReal = Math.cos(angle);
        const wImag = Math.sin(angle);
        for (let i = 0; i < n; i += len) {
            let wCurReal = 1;
            let wCurImag = 0;
            for (let j = 0; j < halfLen; j++) {
                const uReal = real[i + j];
                const uImag = imag[i + j];
                const vReal = real[i + j + halfLen] * wCurReal - imag[i + j + halfLen] * wCurImag;
                const vImag = real[i + j + halfLen] * wCurImag + imag[i + j + halfLen] * wCurReal;
                real[i + j] = uReal + vReal;
                imag[i + j] = uImag + vImag;
                real[i + j + halfLen] = uReal - vReal;
                imag[i + j + halfLen] = uImag - vImag;
                const wNextReal = wCurReal * wReal - wCurImag * wImag;
                const wNextImag = wCurReal * wImag + wCurImag * wReal;
                wCurReal = wNextReal;
                wCurImag = wNextImag;
            }
        }
    }
}

function updateTrajectories() {
    if (state.showTraj) {
        // Calculate Combined Trajectory Point using the EXACT same logic as drawRotatingHarmonics
        // This ensures the vector tip always lands perfectly on the trajectory
        const frame = state.frame;
        const tVal = state.t[frame];
        const s = 1.5; // Scale factor

        let cx = 0, cy = 0;

        // H1
        if (state.ampPosHarmonics[0] > 0.001) {
            const mag = state.ampPosHarmonics[0] * s;
            const ang = OMEGA * tVal;
            cx += mag * Math.cos(ang);
            cy += mag * Math.sin(ang);
        }
        // Neg
        if (state.ampNeg > 0.001) {
            const mag = state.ampNeg * s;
            const ang = -OMEGA * tVal;
            cx += mag * Math.cos(ang);
            cy += mag * Math.sin(ang);
        }
        // Harmonics
        for (let k = 2; k <= 13; k++) {
            const amp = state.ampPosHarmonics[k - 1];
            if (amp < 0.001 || k % 3 === 0) continue;
            const isPos = (k % 3 === 1);
            const ang = isPos ? k * OMEGA * tVal : -k * OMEGA * tVal;
            cx += amp * s * Math.cos(ang);
            cy += amp * s * Math.sin(ang);
        }

        // Push the calculated point
        // Note: Y is inverted in drawing, but here we store world coords. 
        // drawTrajectory flips Y, so we store standard math coords (cy).
        // Wait, drawTrajectory does: y = -p.y * scale.
        // drawVector does: y2 = -curY * scale.
        // So we should store 'cy' as positive here.
        state.trajPointsCombined.push({ x: cx, y: cy });

        // Clarke Trajectory (Alpha/Beta)
        state.trajPointsClarke.push({ x: signalsAlpha[state.frame], y: signalsBeta[state.frame] });

        // Extra Trajectories
        if (state.extraTraj && state.showRotFields) {
            // Pos Seq
            let px = 0, py = 0;
            if (state.ampPosHarmonics[0] > 0.001) {
                const mag = state.ampPosHarmonics[0] * s;
                const ang = OMEGA * tVal;
                px += mag * Math.cos(ang);
                py += mag * Math.sin(ang);
            }
            state.trajPointsExtraPos.push({ x: px, y: py });
            // Neg Seq (Resultant is same as Combined for now in this logic? No, ExtraNeg is usually total)
            // Original logic: ExtraNeg was 'resComb'. Let's keep it as total.
            state.trajPointsExtraNeg.push({ x: cx, y: cy });
        }
    }
}

function clearTrajectories() {
    state.trajPointsCombined = [];
    state.trajPointsExtraPos = [];
    state.trajPointsExtraNeg = [];
    state.trajPointsClarke = [];
}

function updateTimeDisplay() {
    els.timeDisplay.textContent = `Time: ${state.t[state.frame].toFixed(2)} s`;
}

function reset() {
    state.isPlaying = false;
    state.anim.active = false;
    els.playBtn.textContent = "Play";
    state.frame = 0;
    els.slider.value = 0;
    clearTrajectories();
    resizeCanvases(); // Resets transforms
    updateTimeDisplay();
}

function applyPreset(name) {
    if (name === "Custom") return;
    const newPos = Array(13).fill(0.0);
    newPos[0] = 1.0;
    if (name === "Wind Blades") { newPos[0] = 1.0; newPos[1] = 0.5; newPos[3] = 0.4; newPos[4] = 0.2; newPos[6] = 0.2; newPos[7] = 0.1; }
    else if (name === "Oak Tree") { newPos[0] = 1.0; newPos[1] = 0.3; newPos[3] = 0.2; newPos[10] = 0.1; newPos[12] = 0.1; }
    else if (name === "Gear") { newPos[0] = 1.0; newPos[10] = 0.1; newPos[12] = 0.1; }
    else if (name === "Hypotrochoid") { newPos[0] = 1.0; newPos[7] = 0.5; }
    else if (name === "Pure Sine") { newPos[0] = 1.0; }
    state.ampPosHarmonics = newPos;
    state.ampNeg = 0.0;
    els.ampInputs.forEach((input, idx) => input.value = state.ampPosHarmonics[idx]);
    els.ampNeg.value = state.ampNeg;
    computeSignals();
    clearTrajectories();
}

// Start
init();
