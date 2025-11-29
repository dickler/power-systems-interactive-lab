// Constants
const OMEGA = 2 * Math.PI;
const T_MAX = 2.0;
const POINTS = 200;
const ANGLES = [0, 120 * Math.PI / 180, 240 * Math.PI / 180];

// FFT Constants
const FFT_CYCLES = 100; // 100 seconds
const FFT_POINTS = 16384; // Power of 2 closest to 100s * 100Hz (approx 10000)
const DT = T_MAX / (POINTS - 1); // approx 0.01s

// Colors
const COLORS_POS = ['#FF5555', '#55FF55', '#5555FF']; // RGB Bright
const COLORS_NEG = ['#FF55FF', '#55FFFF', '#FFFF55']; // MCY Bright
const COLOR_ALPHA = '#FFA500'; // Orange
const COLOR_BETA = '#00FFFF'; // Cyan
const COLOR_RES_POS = '#FFFFFF';
const COLOR_RES_NEG = '#AAAAAA';
const COLOR_GRID = '#333333';
const COLOR_AXIS = '#666666';
const COLOR_FFT_STEM = '#007acc';
const COLOR_FFT_MARKER = '#FF0000';

// State
let state = {
    t: Array.from({ length: POINTS }, (_, i) => i * DT),
    frame: 0,
    isPlaying: false,
    loop: true,

    // Amplitudes
    ampPosHarmonics: [1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], // H1-H13
    ampNeg: 0.1,

    // Transform Type
    transformType: 'amp', // 'amp' or 'power'

    // FFT
    fftSignalSelection: 'Complex Vector',
    fftData: { freqs: [], mags: [] },

    // Visualization
    decomposition: true,
    showTraj: true,
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
    speedSelect: document.getElementById('speed-select'),

    ampInputs: [
        document.getElementById('amp-h1'),
        document.getElementById('amp-h2'),
        document.getElementById('amp-h3'),
        document.getElementById('amp-h4'),
        document.getElementById('amp-h5'),
        document.getElementById('amp-h6'),
        document.getElementById('amp-h7'),
        document.getElementById('amp-h8'),
        document.getElementById('amp-h9'),
        document.getElementById('amp-h10'),
        document.getElementById('amp-h11'),
        document.getElementById('amp-h12'),
        document.getElementById('amp-h13')
    ],
    ampNeg: document.getElementById('amp-neg'),

    transAmp: document.getElementById('trans-amp'),
    transPower: document.getElementById('trans-power'),

    fftSelect: document.getElementById('fft-signal-select'),

    decompCheck: document.getElementById('decomp-check'),
    trajCheck: document.getElementById('traj-check'),
    rotFieldsCheck: document.getElementById('rot-fields-check'),
    extraTrajCheck: document.getElementById('extra-traj-check'),

    canvases: {
        fieldCombined: document.getElementById('field-combined'),
        signalCombined: document.getElementById('signal-combined'),
        fieldClarke: document.getElementById('field-clarke'),
        signalClarke: document.getElementById('signal-clarke'),
        signalFFT: document.getElementById('signal-fft')
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
    console.log("Initializing Clarke FFT Web Version...");
    resizeCanvases();
    window.addEventListener('resize', resizeCanvases);

    // Event Listeners
    els.playBtn.addEventListener('click', togglePlay);
    els.resetBtn.addEventListener('click', reset);
    els.slider.addEventListener('input', (e) => updateFrame(parseInt(e.target.value)));
    els.loopCheck.addEventListener('change', (e) => state.loop = e.target.checked);
    els.speedSelect.addEventListener('change', (e) => state.speedMult = parseFloat(e.target.value));

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

    // FFT Selection
    els.fftSelect.addEventListener('change', (e) => {
        state.fftSignalSelection = e.target.value;
        computeFFT();
        draw();
    });

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

// Zoom/Pan Logic
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
// High-res signals for FFT
let signalsCombinedFFT, signalsAlphaFFT, signalsBetaFFT;

function computeSignals() {
    signalsPos = [];
    signalsNeg = [];
    signalsCombined = [];
    signalsAlpha = [];
    signalsBeta = [];

    // For FFT, we compute 100 seconds of data
    // But for display, we only store the first 2 seconds (POINTS)
    // To avoid storing massive arrays for display, we'll compute FFT data separately or on the fly
    // Actually, let's compute the display signals first (2s)

    const k = state.transformType === 'amp' ? 2 / 3 : Math.sqrt(2 / 3);

    for (let i = 0; i < POINTS; i++) {
        const ti = state.t[i];
        const { rowComb, alpha, beta, rowPos, rowNeg } = computeSample(ti, k);
        signalsPos.push(rowPos);
        signalsNeg.push(rowNeg);
        signalsCombined.push(rowComb);
        signalsAlpha.push(alpha);
        signalsBeta.push(beta);
    }

    computeFFT();
}

function computeSample(ti, k) {
    // Positive Sequence
    let rowPos = [0, 0, 0];
    state.ampPosHarmonics.forEach((amp, idx) => {
        if (amp > 0.001) {
            const h = idx + 1;
            for (let ph = 0; ph < 3; ph++) {
                rowPos[ph] += amp * Math.cos(h * (OMEGA * ti - ANGLES[ph]));
            }
        }
    });

    // Negative Sequence
    const rowNeg = ANGLES.map(angle => state.ampNeg * Math.cos(OMEGA * ti + angle));

    // Combined
    const rowComb = rowPos.map((v, idx) => v + rowNeg[idx]);

    // Clarke Transform
    const a = rowComb[0];
    const b = rowComb[1];
    const c = rowComb[2];

    const alpha = k * (a - 0.5 * b - 0.5 * c);
    const beta = k * (Math.sqrt(3) / 2 * b - Math.sqrt(3) / 2 * c);

    return { rowComb, alpha, beta, rowPos, rowNeg };
}

function computeFFT() {
    // 1. Generate Signal (100s)
    const N = FFT_POINTS;
    const signalReal = new Float32Array(N);
    const signalImag = new Float32Array(N);

    const k = state.transformType === 'amp' ? 2 / 3 : Math.sqrt(2 / 3);
    const selection = state.fftSignalSelection;

    // Flat Top Window (for accurate amplitude)
    // Coefficients (Periodic)
    const a0 = 0.21557895;
    const a1 = 0.41663158;
    const a2 = 0.277263158;
    const a3 = 0.083578947;
    const a4 = 0.006947368;

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

        let valReal = 0;
        let valImag = 0;

        if (selection === "Phase A") valReal = rowComb[0];
        else if (selection === "Phase B") valReal = rowComb[1];
        else if (selection === "Phase C") valReal = rowComb[2];
        else if (selection === "Alpha") valReal = alpha;
        else if (selection === "Beta") valReal = beta;
        else if (selection === "Complex Vector") {
            valReal = alpha;
            valImag = beta;
        }

        // Apply Window
        signalReal[i] = valReal * window[i];
        signalImag[i] = valImag * window[i];
    }

    // 2. Perform FFT
    transform(signalReal, signalImag);

    // 3. Process Magnitude & Frequencies
    // FFT Shift logic: 0..N/2 is 0..Fs/2, N/2..N is -Fs/2..0
    // We want to display -5 to 5 Hz (Harmonics)
    // Fs = 1/DT approx 100Hz.
    // Bin resolution = Fs / N approx 100 / 16384 = 0.006 Hz

    const mags = [];
    const freqs = [];

    for (let i = 0; i < N; i++) {
        // Shifted index
        let idx = i < N / 2 ? i + N / 2 : i - N / 2;
        // Wait, standard shift:
        // 0..N/2-1 -> N/2..N-1
        // N/2..N-1 -> 0..N/2-1
        // Actually, let's just iterate -N/2 to N/2

        // Frequency for bin i
        let freq = 0;
        let mag = 0;

        if (i < N / 2) {
            // Positive freqs 0..N/2
            freq = i / (N * DT);
            mag = Math.sqrt(signalReal[i] ** 2 + signalImag[i] ** 2);
        } else {
            // Negative freqs
            freq = (i - N) / (N * DT);
            mag = Math.sqrt(signalReal[i] ** 2 + signalImag[i] ** 2);
        }

        // Normalize
        mag /= windowSum;

        // Filter Range (-13.5 to 13.5)
        if (freq >= -13.5 && freq <= 13.5) {
            freqs.push(freq);
            mags.push(mag);
        }
    }

    // Sort by freq
    const combined = freqs.map((f, i) => ({ f, m: mags[i] }));
    combined.sort((a, b) => a.f - b.f);

    // Peak Filtering
    const filteredFreqs = [];
    const filteredMags = [];

    for (let i = 0; i < combined.length; i++) {
        const m = combined[i].m;
        if (m > 0.004) {
            // Local Maxima Check
            // Check neighbors (handling edges)
            const prev = i > 0 ? combined[i - 1].m : 0;
            const next = i < combined.length - 1 ? combined[i + 1].m : 0;

            if (m > prev && m > next) {
                filteredFreqs.push(combined[i].f);
                filteredMags.push(m);
            }
        }
    }

    state.fftData = { freqs: filteredFreqs, mags: filteredMags };
}

// Simple Radix-2 FFT (In-place)
// Input: real and imag arrays of length N (power of 2)
function transform(real, imag) {
    const n = real.length;
    if (n <= 1) return;

    // Bit-reversal permutation
    let i = 0;
    for (let j = 0; j < n - 1; j++) {
        if (j < i) {
            [real[j], real[i]] = [real[i], real[j]];
            [imag[j], imag[i]] = [imag[i], imag[j]];
        }
        let k = n >> 1;
        while (k <= i) {
            i -= k;
            k >>= 1;
        }
        i += k;
    }

    // Butterfly
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

        state.trajPointsClarke.push({ x: signalsAlpha[frame], y: signalsBeta[frame] });

        if (state.extraTraj && state.showRotFields) {
            const resPos = getVecSum(signalsPos, frame);
            state.trajPointsExtraPos.push(resPos);
            state.trajPointsExtraNeg.push(resComb);
        }
    }

    draw();
}

function animate(timestamp) {
    if (state.isPlaying) {
        const speedMult = state.speedMult || 1.0;
        const delay = FRAME_DELAY / speedMult;

        if (timestamp - lastFrameTime >= delay) {
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

    // 5. FFT
    drawFFT(ctxs.signalFFT, els.canvases.signalFFT.id);
}

function drawGrid(ctx, w, h, cx, cy, baseScale, viewState) {
    ctx.strokeStyle = COLOR_GRID;
    ctx.lineWidth = 1 / viewState.scale;
    ctx.beginPath();

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
    } else if (type === 'clarke') {
        vectors.push({ x: signalsAlpha[frame], y: 0, c: COLOR_ALPHA });
        vectors.push({ x: 0, y: signalsBeta[frame], c: COLOR_BETA });
    }

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

    if (type === 'combined' && state.showRotFields) {
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

    // Grid
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

    ctx.strokeStyle = COLOR_AXIS;
    ctx.lineWidth = 2 / viewState.scale;
    ctx.beginPath();
    if (cy >= yMin && cy <= yMax) { ctx.moveTo(xMin, cy); ctx.lineTo(xMax, cy); }
    ctx.stroke();

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
            const mx = state.frame * xScale;
            const my = cy - signals[state.frame][i] * yScale;
            ctx.beginPath(); ctx.fillStyle = colors[i]; ctx.arc(mx, my, 4 / viewState.scale, 0, Math.PI * 2); ctx.fill();
        }
    } else if (type === 'clarke') {
        ctx.beginPath(); ctx.strokeStyle = COLOR_ALPHA; ctx.lineWidth = 2 / viewState.scale;
        for (let j = 0; j < POINTS; j++) {
            const x = j * xScale;
            const y = cy - signalsAlpha[j] * yScale;
            if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        let mx = state.frame * xScale; let my = cy - signalsAlpha[state.frame] * yScale;
        ctx.beginPath(); ctx.fillStyle = COLOR_ALPHA; ctx.arc(mx, my, 4 / viewState.scale, 0, Math.PI * 2); ctx.fill();

        ctx.beginPath(); ctx.strokeStyle = COLOR_BETA; ctx.lineWidth = 2 / viewState.scale;
        for (let j = 0; j < POINTS; j++) {
            const x = j * xScale;
            const y = cy - signalsBeta[j] * yScale;
            if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        mx = state.frame * xScale; my = cy - signalsBeta[state.frame] * yScale;
        ctx.beginPath(); ctx.fillStyle = COLOR_BETA; ctx.arc(mx, my, 4 / viewState.scale, 0, Math.PI * 2); ctx.fill();
    }

    ctx.restore();
}

function drawFFT(ctx, canvasId) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const viewState = state.viewStates[canvasId];

    ctx.save();
    ctx.clearRect(0, 0, w, h);

    ctx.translate(viewState.offsetX, viewState.offsetY);
    ctx.translate(w / 2, h / 2);
    ctx.scale(viewState.scale, viewState.scale);
    ctx.translate(-w / 2, -h / 2);

    // X-Axis: -13.5 to 13.5
    // Y-Axis: 0 to 1 (or max)
    const xRange = 27; // -13.5 to 13.5
    const xScale = w / xRange;
    const yScale = h * 0.8; // Leave some margin
    const cx = w / 2;
    const cy = h * 0.9; // Bottom axis

    // Auto-scale Y if max > 1
    let maxMag = 1.0;
    if (state.fftData.mags.length > 0) {
        const peak = Math.max(...state.fftData.mags);
        if (peak > 1.0) maxMag = peak * 1.1;
    }
    const yFactor = yScale / maxMag;

    // Grid
    ctx.strokeStyle = COLOR_GRID;
    ctx.lineWidth = 1 / viewState.scale;
    ctx.beginPath();

    // X Grid (Integer steps)
    for (let i = -13; i <= 13; i++) {
        const x = cx + i * xScale;
        ctx.moveTo(x, cy); ctx.lineTo(x, cy - maxMag * yFactor);
    }
    // Y Grid (0.1 steps)
    for (let val = 0; val <= maxMag; val += 0.1) {
        const y = cy - val * yFactor;
        ctx.moveTo(cx - 13.5 * xScale, y); ctx.lineTo(cx + 13.5 * xScale, y);
    }
    ctx.stroke();

    // Axis
    ctx.strokeStyle = COLOR_AXIS;
    ctx.lineWidth = 2 / viewState.scale;
    ctx.beginPath();
    ctx.moveTo(cx - 13.5 * xScale, cy); ctx.lineTo(cx + 13.5 * xScale, cy); // X Axis
    ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - maxMag * yFactor); // Y Axis (Center)
    ctx.stroke();

    // Axis Labels
    ctx.fillStyle = COLOR_AXIS;
    ctx.font = `${12 / viewState.scale}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    // X Labels
    for (let i = -13; i <= 13; i++) {
        const x = cx + i * xScale;
        ctx.fillText(i.toString(), x, cy + 5 / viewState.scale);
    }

    // Y Labels
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let val = 0; val <= maxMag; val += 0.2) {
        if (val === 0) continue; // Skip 0 to avoid overlap
        const y = cy - val * yFactor;
        ctx.fillText(val.toFixed(1), cx - 5 / viewState.scale, y);
    }

    // Draw Stem Plot
    const { freqs, mags } = state.fftData;

    for (let i = 0; i < freqs.length; i++) {
        const f = freqs[i];
        const m = mags[i];

        const x = cx + f * xScale;
        const y = cy - m * yFactor;

        // Line
        ctx.beginPath();
        ctx.strokeStyle = COLOR_FFT_STEM;
        ctx.lineWidth = 2 / viewState.scale;
        ctx.moveTo(x, cy);
        ctx.lineTo(x, y);
        ctx.stroke();

        // Marker
        ctx.beginPath();
        ctx.fillStyle = COLOR_FFT_MARKER;
        ctx.arc(x, y, 4 / viewState.scale, 0, Math.PI * 2);
        ctx.fill();
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
