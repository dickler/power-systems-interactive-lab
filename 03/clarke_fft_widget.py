import sys
import numpy as np
from PyQt5.QtWidgets import (
    QApplication, QWidget, QVBoxLayout, QGridLayout, QSlider, QLabel,
    QPushButton, QCheckBox, QDoubleSpinBox, QHBoxLayout, QGroupBox, QFrame,
    QSizePolicy, QSplitter, QRadioButton, QComboBox, QColorDialog
)
from PyQt5.QtCore import Qt, QTimer
from PyQt5.QtGui import QColor, QPalette, QFont, QPixmap, QIcon, QPainter, QPen, QBrush, QPolygonF
from PyQt5.QtCore import QPointF, QRectF
import pyqtgraph as pg

# --- Styling & Parameters ---

# Modern Dark Theme Colors
COLOR_BG = "#1e1e1e"
COLOR_PANEL = "#252526"
COLOR_TEXT = "#d4d4d4"
COLOR_ACCENT = "#007acc"
COLOR_ACCENT_HOVER = "#0098ff"
COLOR_BORDER = "#3e3e42"

# Plot Colors (Neon/Bright for dark background)
COLOR_POS_SEQ = ['#FF5555', '#55FF55', '#5555FF']  # Red, Green, Blue (Bright)
COLOR_NEG_SEQ = ['#FF55FF', '#55FFFF', '#FFFF55']  # Magenta, Cyan, Yellow (Bright)
COLOR_RES_POS = '#FFFFFF'
COLOR_RES_NEG = '#AAAAAA'

# Parameters
omega = 2 * np.pi
t = np.linspace(0, 2, 200)
dt = t[1] - t[0]
angles = np.array([0, 120, 240]) * np.pi / 180

# Configure PyQtGraph global look
pg.setConfigOption('background', COLOR_BG)
pg.setConfigOption('foreground', COLOR_TEXT)
pg.setConfigOptions(antialias=True)

# Distinct colors for harmonics (H1-H13)
DEFAULT_HARM_COLORS = [
    '#55FF55', # H1 (Green)
    '#FF55FF', # H2 (Magenta)
    '#FFFF55', # H3 (Yellow)
    '#00FFFF', # H4 (Cyan)
    '#FF5555', # H5 (Red)
    '#FFA500', # H6 (Orange)
    '#800080', # H7 (Purple)
    '#008000', # H8 (Dark Green)
    '#0000FF', # H9 (Blue)
    '#FFC0CB', # H10 (Pink)
    '#A52A2A', # H11 (Brown)
    '#808080', # H12 (Gray)
    '#FFFFFF', # H13 (White)
]

class ColorButton(QPushButton):
    def __init__(self, color, parent=None):
        super().__init__(parent)
        self.setFixedSize(24, 24)
        self.setStyleSheet("border: none;") # Remove border
        self.setColor(color)
        self.clicked.connect(self.pickColor)
        self.colorChanged = None # Callback

    def setColor(self, color):
        self._color = QColor(color)
        self.updateIcon()

    def updateIcon(self):
        pixmap = QPixmap(16, 16)
        pixmap.fill(self._color)
        self.setIcon(QIcon(pixmap))

    def color(self):
        return self._color.name()

    def pickColor(self):
        color = QColorDialog.getColor(self._color, self, "Select Color")
        if color.isValid():
            self.setColor(color)
            if self.colorChanged:
                self.colorChanged()

class OverlayWidget(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setAttribute(Qt.WA_TransparentForMouseEvents)
        self.setAttribute(Qt.WA_NoSystemBackground)
        self.setAttribute(Qt.WA_TranslucentBackground) # Ensure transparency
        self.arrow_start = None
        self.arrow_end = None
        self.arrow_color = QColor(255, 255, 255)

    def show_arrow(self, start, end, color):
        self.arrow_start = start
        self.arrow_end = end
        self.arrow_color = QColor(color)
        self.update()

    def clear_arrow(self):
        self.arrow_start = None
        self.arrow_end = None
        self.update()

    def paintEvent(self, event):
        if self.arrow_start and self.arrow_end:
            painter = QPainter(self)
            painter.setRenderHint(QPainter.Antialiasing)
            
            pen = QPen(self.arrow_color, 3)
            painter.setPen(pen)
            painter.setBrush(self.arrow_color)
            
            # Draw line
            painter.drawLine(self.arrow_start, self.arrow_end)
            
            # Draw arrow head
            angle = np.arctan2(self.arrow_end.y() - self.arrow_start.y(), self.arrow_end.x() - self.arrow_start.x())
            arrow_size = 15
            
            p1 = self.arrow_end - QPointF(arrow_size * np.cos(angle - np.pi/6), arrow_size * np.sin(angle - np.pi/6))
            p2 = self.arrow_end - QPointF(arrow_size * np.cos(angle + np.pi/6), arrow_size * np.sin(angle + np.pi/6))
            
            arrow_head = QPolygonF([self.arrow_end, p1, p2])
            painter.drawPolygon(arrow_head)

class ClarkeFFTWidget(QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Clarke Transform & FFT Visualization")
        self.resize(1200, 900) # Increased height for 3rd row
        self.apply_stylesheet()

        # Default amplitudes
        self.amp_pos_harmonics = [1.0] + [0.0] * 12 # H1 to H13
        self.amp_neg = 0.1

        # Main Layout (Horizontal: Sidebar + Content)
        main_layout = QHBoxLayout(self)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)

        # --- Sidebar ---
        sidebar = QFrame()
        sidebar.setObjectName("Sidebar")
        sidebar.setFixedWidth(320) # Slightly wider for 2 columns of harmonics
        sidebar_layout = QVBoxLayout(sidebar)
        sidebar_layout.setContentsMargins(10, 10, 10, 10)
        sidebar_layout.setSpacing(8)

        # Title in Sidebar
        title_label = QLabel("Controls")
        title_label.setObjectName("SidebarTitle")
        title_label.setAlignment(Qt.AlignCenter)
        sidebar_layout.addWidget(title_label)

        # Playback Controls
        group_playback = QGroupBox("Playback")
        group_playback = QGroupBox("Playback")
        layout_playback = QVBoxLayout()
        layout_playback.setContentsMargins(5, 15, 5, 5)
        layout_playback.setSpacing(5)
        
        self.slider_label = QLabel("Time: 0.00 s")
        self.slider = QSlider(Qt.Horizontal)
        self.slider.setMinimum(0)
        self.slider.setMaximum(len(t)-1)
        self.slider.valueChanged.connect(self.update_plots)

        hbox_buttons = QHBoxLayout()
        self.play_button = QPushButton("Play")
        self.play_button.clicked.connect(self.toggle_play)
        self.reset_button = QPushButton("Reset")
        self.reset_button.clicked.connect(self.reset_all)
        hbox_buttons.addWidget(self.play_button)
        hbox_buttons.addWidget(self.reset_button)

        self.loop_checkbox = QCheckBox("Loop Animation")
        self.loop_checkbox.setChecked(True)
        
        # Speed Control
        hbox_speed = QHBoxLayout()
        hbox_speed.addWidget(QLabel("Speed:"))
        self.combo_speed = QComboBox()
        self.combo_speed.addItems(["0.25x", "0.5x", "1x", "2x", "5x", "10x"])
        self.combo_speed.setCurrentIndex(2) # Default 1x
        self.combo_speed.currentIndexChanged.connect(self.on_speed_changed)
        hbox_speed.addWidget(self.combo_speed)

        layout_playback.addWidget(self.slider_label)
        layout_playback.addWidget(self.slider)
        layout_playback.addLayout(hbox_buttons)
        layout_playback.addLayout(hbox_speed)
        layout_playback.addWidget(self.loop_checkbox)
        group_playback.setLayout(layout_playback)
        sidebar_layout.addWidget(group_playback)

        # Presets
        group_presets = QGroupBox("Presets")
        layout_presets = QVBoxLayout()
        layout_presets.setContentsMargins(5, 15, 5, 5)
        
        self.combo_presets = QComboBox()
        self.combo_presets.addItems(["Custom", "Wind Blades", "Oak Tree", "Gear", "Hypotrochoid", "Pure Sine"])
        self.combo_presets.currentIndexChanged.connect(self.apply_preset)
        layout_presets.addWidget(self.combo_presets)
        
        group_presets.setLayout(layout_presets)
        sidebar_layout.addWidget(group_presets)

        # 2. Amplitudes
        group_amps = QGroupBox("Amplitudes")

        layout_amps = QGridLayout()
        layout_amps.setContentsMargins(5, 15, 5, 5)
        layout_amps.setSpacing(5)
        
        layout_amps.addWidget(QLabel("Harmonics:"), 0, 0, 1, 4)
        
        self.amp_pos_inputs = []
        self.harmonic_color_btns = []
        
        for i in range(13):
            h_num = i + 1
            # Split into 2 columns: H1-H7 in col 0-2, H8-H13 in col 3-5
            if i < 7:
                row = i + 1
                col_label = 0
                col_spin = 1
                col_color = 2
            else:
                row = (i - 7) + 1
                col_label = 3
                col_spin = 4
                col_color = 5
            
            # Determine sequence type
            rem = h_num % 3
            if rem == 1:
                seq_sym = "(+)"
                seq_color = "#55FF55" # Green
            elif rem == 2:
                seq_sym = "(-)"
                seq_color = "#FF55FF" # Magenta
            else:
                seq_sym = "(0)"
                seq_color = "#FFFF55" # Yellow
                
            # Make H# bold and larger, sequence indicator smaller
            label_text = f'<span style="font-weight:bold; font-size:10pt;">H{h_num}</span> <span style="font-size:7pt; color:{seq_color};">{seq_sym}</span>:'
            label = QLabel(label_text)
            label.setTextFormat(Qt.RichText)
            
            layout_amps.addWidget(label, row, col_label)
            spin = QDoubleSpinBox()
            spin.setRange(0.0, 10.0)
            spin.setValue(self.amp_pos_harmonics[i])
            spin.setSingleStep(0.1)
            spin.valueChanged.connect(self.update_amplitudes)
            layout_amps.addWidget(spin, row, col_spin)
            self.amp_pos_inputs.append(spin)
            
            # Color Button
            btn_color = ColorButton(DEFAULT_HARM_COLORS[i])
            btn_color.colorChanged = self.on_color_changed
            layout_amps.addWidget(btn_color, row, col_color)
            self.harmonic_color_btns.append(btn_color)

        layout_amps.addWidget(QLabel("Negative Seq (Fund):"), 8, 0, 1, 2)
        self.amp_neg_input = QDoubleSpinBox()
        self.amp_neg_input.setRange(0.0, 10.0)
        self.amp_neg_input.setValue(self.amp_neg)
        self.amp_neg_input.setSingleStep(0.1)
        self.amp_neg_input.valueChanged.connect(self.update_amplitudes)
        layout_amps.addWidget(self.amp_neg_input, 8, 2, 1, 2)
        
        self.btn_neg_color = ColorButton(COLOR_NEG_SEQ[0]) # Default Magenta
        self.btn_neg_color.colorChanged = self.on_color_changed
        layout_amps.addWidget(self.btn_neg_color, 8, 4)

        group_amps.setLayout(layout_amps)
        sidebar_layout.addWidget(group_amps)

        # 3. Transform Type
        group_transform = QGroupBox("Transform Type")
        group_transform = QGroupBox("Transform Type")
        layout_transform = QVBoxLayout()
        layout_transform.setContentsMargins(5, 15, 5, 5)
        layout_transform.setSpacing(5)
        
        self.radio_amp_inv = QRadioButton("Amplitude Invariant (k=2/3)")
        self.radio_amp_inv.setChecked(True) # Default Checked
        self.radio_amp_inv.toggled.connect(self.update_amplitudes)
        
        self.radio_power_inv = QRadioButton("Power Invariant (k=√2/3)")
        self.radio_power_inv.toggled.connect(self.update_amplitudes)
        
        layout_transform.addWidget(self.radio_amp_inv)
        layout_transform.addWidget(self.radio_power_inv)
        group_transform.setLayout(layout_transform)
        sidebar_layout.addWidget(group_transform)

        # 4. FFT Analysis (New)
        group_fft = QGroupBox("FFT Analysis")
        group_fft = QGroupBox("FFT Analysis")
        layout_fft = QVBoxLayout()
        layout_fft.setContentsMargins(5, 15, 5, 5)
        layout_fft.setSpacing(5)
        
        layout_fft.addWidget(QLabel("Select Signal:"))
        self.fft_signal_combo = QComboBox()
        self.fft_signal_combo.addItems([
            "Phase A", "Phase B", "Phase C",
            "Alpha", "Beta",
            "Complex Vector (α + jβ)"
        ])
        self.fft_signal_combo.setCurrentText("Complex Vector (α + jβ)") # Default
        self.fft_signal_combo.currentIndexChanged.connect(self.compute_fft)
        layout_fft.addWidget(self.fft_signal_combo)
        
        group_fft.setLayout(layout_fft)
        sidebar_layout.addWidget(group_fft)

        # 5. Visualization Options
        group_viz = QGroupBox("Visualization")
        group_viz = QGroupBox("Visualization")
        layout_viz = QVBoxLayout()
        layout_viz.setContentsMargins(5, 15, 5, 5)
        layout_viz.setSpacing(5)

        self.decomposition_checkbox = QCheckBox("Decomposition Mode")
        self.decomposition_checkbox.setChecked(True) # Default Checked
        self.decomposition_checkbox.stateChanged.connect(self.update_plots)
        
        self.trajectory_checkbox = QCheckBox("Show Trajectory")
        self.trajectory_checkbox.setChecked(True) # Default Checked
        self.trajectory_checkbox.stateChanged.connect(self.toggle_trajectory)

        self.show_rotating_fields_checkbox = QCheckBox("Show Pos/Neg in Combined")
        self.show_rotating_fields_checkbox.stateChanged.connect(self.update_plots)

        self.extra_trajectory_checkbox = QCheckBox("Trajectory for Extra Fields")
        self.extra_trajectory_checkbox.setEnabled(False)
        self.extra_trajectory_checkbox.stateChanged.connect(self.toggle_extra_trajectory)

        self.chk_harmonic_rot = QCheckBox("Rot. Each Harm")
        self.chk_harmonic_rot.stateChanged.connect(self.update_plots)
        self.chk_harmonic_rot.stateChanged.connect(self.toggle_show_harmonics_btn)

        self.btn_show_harmonics = QPushButton("Show My Harmonics")
        self.btn_show_harmonics.setEnabled(False)
        self.btn_show_harmonics.clicked.connect(self.start_harmonics_sequence)

        layout_viz.addWidget(self.decomposition_checkbox)
        layout_viz.addWidget(self.trajectory_checkbox)
        layout_viz.addWidget(self.show_rotating_fields_checkbox)
        layout_viz.addWidget(self.extra_trajectory_checkbox)
        layout_viz.addWidget(self.chk_harmonic_rot)
        layout_viz.addWidget(self.btn_show_harmonics)
        group_viz.setLayout(layout_viz)
        sidebar_layout.addWidget(group_viz)

        # Overlay for arrows
        self.overlay = OverlayWidget(self)
        self.overlay.resize(self.size())
        self.overlay.raise_()


        sidebar_layout.addStretch() # Push everything up
        main_layout.addWidget(sidebar)

        # --- Content Area (Plots) ---
        content_widget = QWidget()
        grid = QGridLayout(content_widget)
        grid.setContentsMargins(10, 10, 10, 10)
        grid.setSpacing(10)

        # 1. Combined Field (Phasor ABC) - Top Left
        self.field_combined = self.create_field("ABC Phasors")
        grid.addWidget(self.field_combined, 0, 0)

        # 2. Combined Signals (Time Domain ABC) - Top Right
        self.plot_combined = self.create_signal_plot("ABC Signals")
        grid.addWidget(self.plot_combined, 0, 1)

        # 3. Clarke Field (Phasor Alpha-Beta) - Middle Left
        self.field_clarke = self.create_field("Clarke Transform - αβ")
        grid.addWidget(self.field_clarke, 1, 0)

        # 4. Clarke Signals (Time Domain Alpha-Beta) - Middle Right
        self.plot_clarke = self.create_signal_plot("αβ Signals")
        grid.addWidget(self.plot_clarke, 1, 1)
        
        # 5. FFT Spectrum - Bottom (Spanning 2 columns)
        self.plot_fft = self.create_signal_plot("Double Sided FFT")
        self.plot_fft.setLabel('bottom', "Harmonic Order")
        self.plot_fft.setLabel('left', "Magnitude")
        self.plot_fft.getPlotItem().getAxis('left').enableAutoSIPrefix(False)
        self.plot_fft.setYRange(0, 1)
        self.plot_fft.setXRange(-13.5, 13.5)
        self.plot_fft.getPlotItem().getAxis('bottom').setTickSpacing(1, 1)
        grid.addWidget(self.plot_fft, 2, 0, 1, 2)

        # Set stretch factors
        grid.setColumnStretch(0, 1)
        grid.setColumnStretch(1, 1)
        grid.setRowStretch(0, 1)
        grid.setRowStretch(1, 1)
        grid.setRowStretch(2, 1)

        main_layout.addWidget(content_widget)

        # --- Initialization of Graphics Items ---
        
        # --- ABC Items ---
        # Vectors
        self.lines_combined, self.tips_combined = self.create_vectors(self.field_combined, COLOR_POS_SEQ + COLOR_NEG_SEQ)
        self.resultant_line_combined, self.resultant_tip_combined = self.create_resultant(self.field_combined)

        # Extra rotating fields for combined
        self.extra_line_pos = pg.PlotDataItem(pen=pg.mkPen(COLOR_RES_POS, width=2, style=Qt.DashLine))
        self.extra_tip_pos = pg.ScatterPlotItem(size=10, brush=COLOR_RES_POS)
        self.field_combined.addItem(self.extra_line_pos)
        self.field_combined.addItem(self.extra_tip_pos)

        self.extra_line_neg = pg.PlotDataItem(pen=pg.mkPen(COLOR_RES_NEG, width=2, style=Qt.DashLine))
        self.extra_tip_neg = pg.ScatterPlotItem(size=10, brush=COLOR_RES_NEG)
        self.field_combined.addItem(self.extra_line_neg)
        self.field_combined.addItem(self.extra_tip_neg)

        # Trajectories ABC
        self.trajectory_combined = pg.PlotDataItem(pen=pg.mkPen(COLOR_RES_POS, width=1))
        self.field_combined.addItem(self.trajectory_combined)

        # Extra trajectories ABC
        self.extra_trajectory_pos = pg.PlotDataItem(pen=pg.mkPen(COLOR_RES_POS, width=1, style=Qt.DotLine))
        self.field_combined.addItem(self.extra_trajectory_pos)
        self.extra_trajectory_neg = pg.PlotDataItem(pen=pg.mkPen(COLOR_RES_NEG, width=1, style=Qt.DotLine))
        self.field_combined.addItem(self.extra_trajectory_neg)

        # Harmonic Rotating Vectors (Pool for up to 20 vectors)
        self.lines_harmonics = []
        self.tips_harmonics = []
        for _ in range(20):
            line = pg.PlotDataItem(pen=pg.mkPen('w', width=2))
            tip = pg.ScatterPlotItem(size=10, brush='w', pen=None)
            self.field_combined.addItem(line)
            self.field_combined.addItem(tip)
            line.setVisible(False)
            tip.setVisible(False)
            self.lines_harmonics.append(line)
            self.tips_harmonics.append(tip)
        
        # --- Clarke Items ---
        # Vectors (Alpha, Beta)
        COLOR_ALPHA = '#FFA500'
        COLOR_BETA = '#00FFFF'
        self.lines_clarke, self.tips_clarke = self.create_vectors(self.field_clarke, [COLOR_ALPHA, COLOR_BETA])
        self.resultant_line_clarke, self.resultant_tip_clarke = self.create_resultant(self.field_clarke)
        
        # Trajectory Clarke
        self.trajectory_clarke = pg.PlotDataItem(pen=pg.mkPen(COLOR_RES_POS, width=1))
        self.field_clarke.addItem(self.trajectory_clarke)

        self.traj_points_combined = []
        self.traj_points_extra_pos = []
        self.traj_points_extra_neg = []
        self.traj_points_clarke = []

        self.traj_points_clarke = []

        # FFT Curve (Stem Plot)
        # Vertical lines (Pool for individual coloring)
        self.fft_lines_pool = []
        for _ in range(50): # Pool of 50 lines
            line = pg.PlotDataItem(pen=pg.mkPen('#007acc', width=2))
            self.plot_fft.addItem(line)
            line.setVisible(False)
            self.fft_lines_pool.append(line)
            
        # Markers (Red Circles)
        self.fft_stem_markers = pg.ScatterPlotItem(size=10, brush='#FF0000', pen=None)
        self.plot_fft.addItem(self.fft_stem_markers)

        # Initialize signals (Computes signals and FFT, so must be after curve_fft is created)
        self.compute_signals()

        # Signal curves and markers (ABC)
        self.curves_combined = [self.plot_combined.plot(t, self.signals_combined[:, i], pen=pg.mkPen(c, width=2), name=f"{chr(65+i)}") for i, c in enumerate(COLOR_POS_SEQ)]
        self.marker_combined = [self.plot_combined.plot([t[0]], [self.signals_combined[0, i]], pen=None, symbol='o', symbolBrush=c, symbolSize=8) for i, c in enumerate(COLOR_POS_SEQ)]

        # Signal curves and markers (Clarke)
        self.curves_clarke = []
        self.curves_clarke.append(self.plot_clarke.plot(t, self.signals_alpha, pen=pg.mkPen(COLOR_ALPHA, width=2), name="α"))
        self.curves_clarke.append(self.plot_clarke.plot(t, self.signals_beta, pen=pg.mkPen(COLOR_BETA, width=2), name="β"))
        
        self.marker_clarke = []
        self.marker_clarke.append(self.plot_clarke.plot([t[0]], [self.signals_alpha[0]], pen=None, symbol='o', symbolBrush=COLOR_ALPHA, symbolSize=8))
        self.marker_clarke.append(self.plot_clarke.plot([t[0]], [self.signals_beta[0]], pen=None, symbol='o', symbolBrush=COLOR_BETA, symbolSize=8))

        # Timer
        self.timer = QTimer()
        self.timer.timeout.connect(self.advance_frame)
        self.is_playing = False

        self.update_plots(0)

    def apply_stylesheet(self):
        self.setStyleSheet(f"""
            QWidget {{
                background-color: {COLOR_BG};
                color: {COLOR_TEXT};
                font-family: 'Segoe UI', sans-serif;
                font-size: 9pt;
            }}
            QFrame#Sidebar {{
                background-color: {COLOR_PANEL};
                border-right: 1px solid {COLOR_BORDER};
            }}
            QLabel#SidebarTitle {{
                font-size: 12pt;
                font-weight: bold;
                color: {COLOR_ACCENT};
                margin-bottom: 10px;
            }}
            QGroupBox {{
                border: 1px solid {COLOR_BORDER};
                border-radius: 6px;
                margin-top: 6px;
                padding-top: 6px;
                font-weight: bold;
            }}
            QGroupBox::title {{
                subcontrol-origin: margin;
                subcontrol-position: top left;
                padding: 0 5px;
                left: 10px;
                color: {COLOR_ACCENT};
            }}
            QPushButton {{
                background-color: {COLOR_ACCENT};
                color: white;
                border: none;
                border-radius: 4px;
                padding: 6px 12px;
                font-weight: bold;
            }}
            QPushButton:hover {{
                background-color: {COLOR_ACCENT_HOVER};
            }}
            QPushButton:pressed {{
                background-color: #005c99;
            }}
            QSlider::groove:horizontal {{
                border: 1px solid {COLOR_BORDER};
                height: 6px;
                background: {COLOR_BG};
                margin: 2px 0;
                border-radius: 3px;
            }}
            QSlider::handle:horizontal {{
                background: {COLOR_ACCENT};
                border: 1px solid {COLOR_ACCENT};
                width: 14px;
                height: 14px;
                margin: -5px 0;
                border-radius: 7px;
            }}
            QCheckBox {{
                spacing: 8px;
            }}
            QCheckBox::indicator {{
                width: 16px;
                height: 16px;
                border: 1px solid {COLOR_BORDER};
                border-radius: 3px;
                background: {COLOR_BG};
            }}
            QCheckBox::indicator:checked {{
                background: {COLOR_ACCENT};
                border-color: {COLOR_ACCENT};
            }}
            QDoubleSpinBox {{
                background-color: {COLOR_BG};
                border: 1px solid {COLOR_BORDER};
                border-radius: 4px;
                padding: 4px;
                selection-background-color: {COLOR_ACCENT};
            }}
            QComboBox {{
                background-color: {COLOR_BG};
                border: 1px solid {COLOR_BORDER};
                border-radius: 4px;
                padding: 4px;
                color: {COLOR_TEXT};
            }}
            QComboBox::drop-down {{
                border: none;
            }}
        """)

    def create_field(self, title):
        field = pg.PlotWidget(title=title)
        field.setXRange(-3, 3)
        field.setYRange(-3, 3)
        field.setAspectLocked(True)
        field.showGrid(x=True, y=True, alpha=0.3)
        field.getPlotItem().setTitle(title, color=COLOR_TEXT, size='11pt')
        return field

    def create_signal_plot(self, title):
        plot = pg.PlotWidget(title=title)
        plot.addLegend(offset=(10, 10))
        plot.showGrid(x=True, y=True, alpha=0.3)
        plot.getPlotItem().setTitle(title, color=COLOR_TEXT, size='11pt')
        return plot

    def create_vectors(self, field, colors):
        lines = [pg.PlotDataItem(pen=pg.mkPen(c, width=3)) for c in colors]
        tips = [pg.ScatterPlotItem(size=12, brush=c, pen=None) for c in colors]
        for line, tip in zip(lines, tips):
            field.addItem(line)
            field.addItem(tip)
        return lines, tips

    def create_resultant(self, field):
        line = pg.PlotDataItem(pen=pg.mkPen('w', width=4))
        tip = pg.ScatterPlotItem(size=16, brush='w', pen=None)
        field.addItem(line)
        field.addItem(tip)
        return line, tip

    def compute_signals(self):
        # Create time vector for FFT (more cycles to improve resolution/windowing)
        # Original t is 0-2s (2 cycles). We use 100s (100 cycles) for FFT.
        self.t_fft = np.arange(0, 100, dt)
        
        # Positive Sequence: Sum of Harmonics 1-5
        self.signals_pos_fft = np.zeros((len(self.t_fft), 3))
        
        for h_idx, amp in enumerate(self.amp_pos_harmonics):
            h_order = h_idx + 1
            if amp > 0.001:
                component = np.array([[amp * np.cos(h_order * (omega * ti - angle)) for angle in angles] for ti in self.t_fft])
                self.signals_pos_fft += component

        self.signals_neg_fft = np.array([[self.amp_neg * np.cos(omega * ti + angle) for angle in angles] for ti in self.t_fft])
        self.signals_combined_fft = self.signals_pos_fft + self.signals_neg_fft
        
        # Clarke Transform FFT
        a = self.signals_combined_fft[:, 0]
        b = self.signals_combined_fft[:, 1]
        c = self.signals_combined_fft[:, 2]
        
        if self.radio_amp_inv.isChecked():
            k = 2/3
        else:
            k = np.sqrt(2/3)
            
        self.signals_alpha_fft = k * (a - 0.5*b - 0.5*c)
        self.signals_beta_fft  = k * (np.sqrt(3)/2 * b - np.sqrt(3)/2 * c)
        
        # Slice for display (first N points corresponding to t)
        n_display = len(t)
        self.signals_pos = self.signals_pos_fft[:n_display]
        self.signals_neg = self.signals_neg_fft[:n_display]
        self.signals_combined = self.signals_combined_fft[:n_display]
        self.signals_alpha = self.signals_alpha_fft[:n_display]
        self.signals_beta = self.signals_beta_fft[:n_display]
        
        self.compute_fft()

    def compute_fft(self):
        selection = self.fft_signal_combo.currentText()
        signal = None
        
        if selection == "Phase A":
            signal = self.signals_combined_fft[:, 0]
        elif selection == "Phase B":
            signal = self.signals_combined_fft[:, 1]
        elif selection == "Phase C":
            signal = self.signals_combined_fft[:, 2]
        elif selection == "Alpha":
            signal = self.signals_alpha_fft
        elif selection == "Beta":
            signal = self.signals_beta_fft
        elif selection == "Complex Vector (α + jβ)":
            signal = self.signals_alpha_fft + 1j * self.signals_beta_fft
            
        if signal is not None:
            N = len(signal)
            # Apply Hanning Window to reduce spectral leakage
            window = np.hanning(N)
            signal_windowed = signal * window
            
            # Compute FFT
            F = np.fft.fft(signal_windowed)
            # Shift so 0 frequency is in center
            F_shifted = np.fft.fftshift(F)
            # Frequencies
            freqs = np.fft.fftshift(np.fft.fftfreq(N, d=dt))
            
            # Magnitude
            # Normalize by sum of window weights (coherent gain correction)
            mag = np.abs(F_shifted) / np.sum(window)
            
            # Filter low magnitudes (threshold 0.004)
            # Also apply local maxima filtering to remove Hanning side lobes
            mask_threshold = mag > 0.004
            
            # Find local maxima
            # Compare each point to its neighbors
            # Prepend/append smaller values to handle edges
            mag_padded = np.pad(mag, 1, mode='constant', constant_values=0)
            mask_peaks = (mag > mag_padded[:-2]) & (mag > mag_padded[2:])
            
            # Combine masks
            mask = mask_threshold & mask_peaks
            
            freqs_filtered = freqs[mask]
            mag_filtered = mag[mask]
            
            # Update Plot (Stem style)
            # Hide all lines first
            for line in self.fft_lines_pool:
                line.setVisible(False)
            
            brushes = []
            
            if len(freqs_filtered) > 0:
                for i, (freq, mag) in enumerate(zip(freqs_filtered, mag_filtered)):
                    if i >= len(self.fft_lines_pool): break
                    
                    line = self.fft_lines_pool[i]
                    
                    # Determine Color
                    h_order = int(round(abs(freq)))
                    color = '#FFFFFF' # Default White
                    
                    if h_order == 1:
                        if freq > 0: # Positive Sequence
                            color = self.harmonic_color_btns[0].color()
                        else: # Negative Sequence
                            color = self.btn_neg_color.color()
                    elif 1 < h_order <= 13:
                        color = self.harmonic_color_btns[h_order-1].color()
                    
                    # Set Line
                    line.setData([freq, freq], [0, mag])
                    line.setPen(pg.mkPen(color, width=2))
                    line.setVisible(True)
                    
                    brushes.append(pg.mkBrush(color))
                
                self.fft_stem_markers.setData(freqs_filtered, mag_filtered, symbolBrush=brushes)
            else:
                self.fft_stem_markers.setData([], [])

            # Handle Y-Axis Range
            max_mag = np.max(mag) if mag.size > 0 else 0
            if max_mag > 1.0:
                self.plot_fft.setYRange(0, max_mag * 1.1)
            else:
                self.plot_fft.setYRange(0, 1.0)

    def apply_preset(self):
        preset = self.combo_presets.currentText()
        if preset == "Custom":
            return

        self.applying_preset = True

        # Default is H1=1.0, others 0
        new_pos = [0.0] * 13
        new_pos[0] = 1.0 # H1 default
        
        if preset == "Wind Blades":
            new_pos[0] = 1.0 # H1
            new_pos[1] = 0.5 # H2
            new_pos[3] = 0.4 # H4
            new_pos[4] = 0.2 # H5
            new_pos[6] = 0.2 # H7
            new_pos[7] = 0.1 # H8
        elif preset == "Oak Tree":
            new_pos[0] = 1.0 # H1
            new_pos[1] = 0.3 # H2
            new_pos[3] = 0.2 # H4
            new_pos[10] = 0.1 # H11
            new_pos[12] = 0.1 # H13
        elif preset == "Gear":
            new_pos[0] = 1.0 # H1
            new_pos[10] = 0.1 # H11
            new_pos[12] = 0.1 # H13
        elif preset == "Hypotrochoid":
            new_pos[0] = 1.0 # H1
            new_pos[7] = 0.5 # H8
        elif preset == "Pure Sine":
            new_pos[0] = 1.0 # H1

        # Update SpinBoxes
        for i, spin in enumerate(self.amp_pos_inputs):
            spin.blockSignals(True)
            spin.setValue(new_pos[i])
            spin.blockSignals(False)
            
        self.amp_neg_input.blockSignals(True)
        self.amp_neg_input.setValue(0.0)
        self.amp_neg_input.blockSignals(False)
        
        self.update_amplitudes()
        self.clear_trajectories()
        self.applying_preset = False

    def update_amplitudes(self):
        if not hasattr(self, 'applying_preset') or not self.applying_preset:
            self.combo_presets.blockSignals(True)
            self.combo_presets.setCurrentText("Custom")
            self.combo_presets.blockSignals(False)

        self.amp_pos_harmonics = [spin.value() for spin in self.amp_pos_inputs]
        self.amp_neg = self.amp_neg_input.value()
        self.compute_signals()
        
        # Update ABC curves
        for i in range(3):
            self.curves_combined[i].setData(t, self.signals_combined[:, i])
            
        # Update Clarke curves
        self.curves_clarke[0].setData(t, self.signals_alpha)
        self.curves_clarke[1].setData(t, self.signals_beta)
        
        self.update_plots(self.slider.value())

    def update_plots(self, frame):
        # Handle slider vs direct call
        if isinstance(frame, int):
            pass
        else:
            frame = self.slider.value()
            
        self.slider_label.setText(f"Time: {t[frame]:.2f} s")

        # Enable extra trajectory checkbox only if conditions are met
        self.extra_trajectory_checkbox.setEnabled(
            (self.trajectory_checkbox.isChecked() and self.show_rotating_fields_checkbox.isChecked()) or
            (self.trajectory_checkbox.isChecked() and self.chk_harmonic_rot.isChecked())
        )

        # Handle "Rot. Each Harm" mode
        is_harmonic_rot_mode = self.chk_harmonic_rot.isChecked()
        
        if is_harmonic_rot_mode:
            self.decomposition_checkbox.setEnabled(False)
            self.show_rotating_fields_checkbox.setEnabled(False)
            # Hide standard ABC vectors
            for line in self.lines_combined: line.setVisible(False)
            for tip in self.tips_combined: tip.setVisible(False)
            self.extra_line_pos.setVisible(False)
            self.extra_tip_pos.setVisible(False)
            self.extra_line_neg.setVisible(False)
            self.extra_tip_neg.setVisible(False)
        else:
            self.decomposition_checkbox.setEnabled(True)
            self.show_rotating_fields_checkbox.setEnabled(True)
            # Hide harmonic vectors
            for line in self.lines_harmonics: line.setVisible(False)
            for tip in self.tips_harmonics: tip.setVisible(False)
            self.extra_line_pos.setVisible(True)
            self.extra_tip_pos.setVisible(True)
            self.extra_line_neg.setVisible(True)
            self.extra_tip_neg.setVisible(True)

        decomposition = self.decomposition_checkbox.isChecked()

        # --- ABC Mode Updates ---
        # Update markers
        for i in range(3):
            self.marker_combined[i].setData([t[frame]], [self.signals_combined[frame, i]])

        # Compute vectors
        vectors_pos = [(self.signals_pos[frame, i]*np.cos(angles[i]), self.signals_pos[frame, i]*np.sin(angles[i])) for i in range(3)]
        vectors_neg = [(self.signals_neg[frame, i]*np.cos(angles[i]), self.signals_neg[frame, i]*np.sin(angles[i])) for i in range(3)]
        vectors_combined = vectors_pos + vectors_neg
        
        sum_pos = (sum(v[0] for v in vectors_pos), sum(v[1] for v in vectors_pos))
        sum_neg = (sum(v[0] for v in vectors_neg), sum(v[1] for v in vectors_neg))
        
        # Update combined vectors
        if not is_harmonic_rot_mode:
            self.update_field_vectors(self.lines_combined, self.tips_combined, vectors_combined, self.resultant_line_combined, self.resultant_tip_combined, decomposition)

            # Fix for artifact when amplitude is 0: Hide vectors if amplitude is 0
            total_pos_amp = sum(self.amp_pos_harmonics)
            if total_pos_amp < 0.01:
                for i in range(3):
                    self.lines_combined[i].setVisible(False)
                    self.tips_combined[i].setVisible(False)
            else:
                for i in range(3):
                    self.lines_combined[i].setVisible(True)
                    self.tips_combined[i].setVisible(True)

            if self.amp_neg < 0.01:
                for i in range(3, 6):
                    self.lines_combined[i].setVisible(False)
                    self.tips_combined[i].setVisible(False)
            else:
                for i in range(3, 6):
                    self.lines_combined[i].setVisible(True)
                    self.tips_combined[i].setVisible(True)
        else:
            # --- Harmonic Rotation Mode ---
            # Calculate rotating vectors for each harmonic
            # H1 Pos: CCW
            # H1 Neg: CW
            # H2: Neg Seq -> CW
            # H3: Zero Seq -> Skip
            # H4: Pos Seq -> CCW
            # ...
            
            harm_vectors = []
            
            # 1. Fundamental Positive Sequence (H1 Pos)
            amp_h1 = self.amp_pos_harmonics[0]
            vec_h1_pos = (0, 0)
            s = 1.5 # Scaling factor to match Combined view
            
            if amp_h1 > 0.001:
                # CCW
                angle = omega * t[frame]
                vec_h1_pos = (amp_h1 * s * np.cos(angle), amp_h1 * s * np.sin(angle))
                harm_vectors.append({'vec': vec_h1_pos, 'color': self.harmonic_color_btns[0].color()})
                
            # 2. Fundamental Negative Sequence (H1 Neg)
            vec_h1_neg = (0, 0)
            if self.amp_neg > 0.001:
                # CW
                angle = -omega * t[frame]
                vec_h1_neg = (self.amp_neg * s * np.cos(angle), self.amp_neg * s * np.sin(angle))
                harm_vectors.append({'vec': vec_h1_neg, 'color': self.btn_neg_color.color()})
                
            # 3. Harmonics (H2 to H13)
            for i in range(1, 13):
                h_order = i + 1
                amp = self.amp_pos_harmonics[i]
                if amp > 0.001:
                    rem = h_order % 3
                    if rem == 1: # Positive Sequence -> CCW
                        angle = h_order * omega * t[frame]
                        vec = (amp * s * np.cos(angle), amp * s * np.sin(angle))
                        harm_vectors.append({'vec': vec, 'color': self.harmonic_color_btns[i].color()})
                    elif rem == 2: # Negative Sequence -> CW
                        angle = -h_order * omega * t[frame]
                        vec = (amp * s * np.cos(angle), amp * s * np.sin(angle))
                        harm_vectors.append({'vec': vec, 'color': self.harmonic_color_btns[i].color()})
                    # Zero sequence (rem == 0) is skipped
            
            # Draw vectors tip-to-tail
            current_x, current_y = 0, 0
            
            # Hide all first
            for line in self.lines_harmonics: line.setVisible(False)
            for tip in self.tips_harmonics: tip.setVisible(False)
            
            for i, item in enumerate(harm_vectors):
                if i >= len(self.lines_harmonics): break
                
                vec = item['vec']
                color = item['color']
                
                line = self.lines_harmonics[i]
                tip = self.tips_harmonics[i]
                
                line.setPen(pg.mkPen(color, width=2))
                tip.setBrush(color)
                
                line.setData([current_x, current_x + vec[0]], [current_y, current_y + vec[1]])
                tip.setData([current_x + vec[0]], [current_y + vec[1]])
                
                line.setVisible(True)
                tip.setVisible(True)
                
                current_x += vec[0]
                current_y += vec[1]
                
            # Update resultant to point to the end of the chain
            self.resultant_line_combined.setData([0, current_x], [0, current_y])
            self.resultant_tip_combined.setData([current_x], [current_y])

            # Fundamental Trajectory (H1 Pos + H1 Neg)
            if self.extra_trajectory_checkbox.isChecked():
                # Sum of H1 Pos and H1 Neg
                vec_fund_x = vec_h1_pos[0] + vec_h1_neg[0]
                vec_fund_y = vec_h1_pos[1] + vec_h1_neg[1]
                
                self.traj_points_extra_pos.append((vec_fund_x, vec_fund_y))
                xs, ys = zip(*self.traj_points_extra_pos)
                self.extra_trajectory_pos.setData(xs, ys)
                # Ensure it's visible and styled
                self.extra_trajectory_pos.setVisible(True)
                self.extra_trajectory_pos.setPen(pg.mkPen(COLOR_RES_POS, width=1, style=Qt.DashLine))
                
                # Hide the neg trajectory in this mode
                self.extra_trajectory_neg.setVisible(False)
            else:
                self.extra_trajectory_pos.setData([], [])
                self.extra_trajectory_neg.setData([], [])

        # --- Clarke Mode Updates ---
        # Update markers
        self.marker_clarke[0].setData([t[frame]], [self.signals_alpha[frame]])
        self.marker_clarke[1].setData([t[frame]], [self.signals_beta[frame]])
        
        # Vectors: Alpha is on X axis, Beta is on Y axis
        val_alpha = self.signals_alpha[frame]
        val_beta = self.signals_beta[frame]
        
        vec_alpha = (val_alpha, 0)
        vec_beta = (0, val_beta)
        vectors_clarke = [vec_alpha, vec_beta]
        
        self.update_field_vectors(self.lines_clarke, self.tips_clarke, vectors_clarke, self.resultant_line_clarke, self.resultant_tip_clarke, decomposition)
        
        # Extra rotating fields in combined
        if self.show_rotating_fields_checkbox.isChecked() and not is_harmonic_rot_mode:
            total_pos_amp = sum(self.amp_pos_harmonics) # Re-calculate for safety if not in scope
            if total_pos_amp >= 0.01:
                x_pos = sum_pos[0]
                y_pos = sum_pos[1]
                self.extra_line_pos.setData([0, x_pos], [0, y_pos])
                self.extra_tip_pos.setData([x_pos], [y_pos])
            else:
                self.extra_line_pos.setData([], [])
                self.extra_tip_pos.setData([], [])
                x_pos, y_pos = 0, 0 

            if self.amp_neg >= 0.01:
                x_neg = sum_neg[0]
                y_neg = sum_neg[1]
                self.extra_line_neg.setData([x_pos, x_pos + x_neg], [y_pos, y_pos + y_neg])
                self.extra_tip_neg.setData([x_pos + x_neg], [y_pos + y_neg])
            else:
                self.extra_line_neg.setData([], [])
                self.extra_tip_neg.setData([], [])
        else:
            self.extra_line_pos.setData([], [])
            self.extra_tip_pos.setData([], [])
            self.extra_line_neg.setData([], [])
            self.extra_tip_neg.setData([], [])

        # Update trajectory if enabled
        if self.trajectory_checkbox.isChecked():
            self.update_trajectory(self.resultant_line_combined, self.traj_points_combined, self.trajectory_combined)
            self.update_trajectory(self.resultant_line_clarke, self.traj_points_clarke, self.trajectory_clarke)

            if self.extra_trajectory_checkbox.isChecked() and self.show_rotating_fields_checkbox.isChecked():
                x_pos = sum_pos[0]
                y_pos = sum_pos[1]
                self.traj_points_extra_pos.append((x_pos, y_pos))
                xs, ys = zip(*self.traj_points_extra_pos)
                self.extra_trajectory_pos.setData(xs, ys)

                x_neg = sum_neg[0]
                y_neg = sum_neg[1]
                tip_x = x_pos + x_neg
                tip_y = y_pos + y_neg
                self.traj_points_extra_neg.append((tip_x, tip_y))
                xs, ys = zip(*self.traj_points_extra_neg)
                self.extra_trajectory_neg.setData(xs, ys)

    def update_field_vectors(self, lines, tips, vectors, resultant_line, resultant_tip, decomposition):
        if decomposition:
            points = [(0, 0)]
            for vec in vectors:
                last = points[-1]
                points.append((last[0] + vec[0], last[1] + vec[1]))
            for i, (line, tip) in enumerate(zip(lines, tips)):
                line.setData([points[i][0], points[i+1][0]], [points[i][1], points[i+1][1]])
                tip.setData([points[i+1][0]], [points[i+1][1]])
            resultant_line.setData([0, points[-1][0]], [0, points[-1][1]])
            resultant_tip.setData([points[-1][0]], [points[-1][1]])
        else:
            x_sum = sum(v[0] for v in vectors)
            y_sum = sum(v[1] for v in vectors)
            for line, tip, vec in zip(lines, tips, vectors):
                line.setData([0, vec[0]], [0, vec[1]])
                tip.setData([vec[0]], [vec[1]])
            resultant_line.setData([0, x_sum], [0, y_sum])
            resultant_tip.setData([x_sum], [y_sum])

    def update_trajectory(self, resultant_line, traj_points, trajectory_item):
        x = resultant_line.xData[-1]
        y = resultant_line.yData[-1]
        traj_points.append((x, y))
        xs, ys = zip(*traj_points)
        trajectory_item.setData(xs, ys)

    def toggle_trajectory(self):
        if not self.trajectory_checkbox.isChecked():
            self.clear_trajectories()

    def toggle_extra_trajectory(self):
        if not self.extra_trajectory_checkbox.isChecked():
            self.traj_points_extra_pos.clear()
            self.traj_points_extra_neg.clear()
            self.extra_trajectory_pos.setData([], [])
            self.extra_trajectory_neg.setData([], [])

    def clear_trajectories(self):
        self.traj_points_combined.clear()
        self.traj_points_extra_pos.clear()
        self.traj_points_extra_neg.clear()
        self.traj_points_clarke.clear()
        self.trajectory_combined.setData([], [])
        self.extra_trajectory_pos.setData([], [])
        self.extra_trajectory_neg.setData([], [])
        self.trajectory_clarke.setData([], [])

    def reset_all(self):
        self.timer.stop()
        self.is_playing = False
        self.play_button.setText("Play")
        self.slider.setValue(0)
        self.clear_trajectories()

    def advance_frame(self):
        current = self.slider.value()
        if current < self.slider.maximum():
            self.slider.setValue(current + 1)
        else:
            if self.loop_checkbox.isChecked():
                self.slider.setValue(0)
                self.clear_trajectories()
            else:
                self.timer.stop()
                self.play_button.setText("Play")
                self.is_playing = False

    def toggle_play(self):
        if self.is_playing:
            self.timer.stop()
            self.play_button.setText("Play")
        else:
            interval = self.get_interval()
            self.timer.start(interval)
            self.play_button.setText("Pause")
        self.is_playing = not self.is_playing

    def get_interval(self):
        speed_mult = float(self.combo_speed.currentText().replace('x', ''))
        # Base interval 50ms (20 FPS) for 1x speed
        interval = int(50 / speed_mult)
        if interval < 1: interval = 1
        return interval

    def update_timer_interval(self):
        interval = self.get_interval()
        if self.timer.isActive():
            self.timer.start(interval)

    def on_speed_changed(self):
        self.update_timer_interval()

    def on_speed_changed(self):
        if self.is_playing:
            self.update_timer_interval()

    def on_color_changed(self):
        self.compute_fft()
        self.update_plots(self.slider.value())

    def resizeEvent(self, event):
        if hasattr(self, 'overlay'):
            self.overlay.resize(self.size())
        super().resizeEvent(event)

    def toggle_show_harmonics_btn(self):
        self.btn_show_harmonics.setEnabled(self.chk_harmonic_rot.isChecked())

    def start_harmonics_sequence(self):
        if self.is_playing:
            self.toggle_play() # Pause

        # Capture current view range to restore later
        self.pre_anim_view_range = self.field_combined.viewRange()

        # 1. Identify active harmonics
        self.active_harmonics_seq = []
        
        # H1 Pos
        if self.amp_pos_harmonics[0] > 0.001:
            self.active_harmonics_seq.append({'type': 'h1_pos', 'freq': 1, 'color': self.harmonic_color_btns[0].color(), 'index': 0})
            
        # H1 Neg
        if self.amp_neg > 0.001:
            self.active_harmonics_seq.append({'type': 'h1_neg', 'freq': -1, 'color': self.btn_neg_color.color(), 'index': 1})
            
        # Others
        for i in range(1, 13):
            h_order = i + 1
            amp = self.amp_pos_harmonics[i]
            if amp > 0.001:
                rem = h_order % 3
                freq = h_order if rem == 1 else -h_order
                if rem != 0: # Skip zero seq
                    self.active_harmonics_seq.append({'type': 'harm', 'freq': freq, 'color': self.harmonic_color_btns[i].color(), 'index': len(self.active_harmonics_seq)})

        if not self.active_harmonics_seq:
            return

        # 3. Start Sequence
        self.seq_step = 0
        self.run_harmonics_step()

    def run_harmonics_step(self):
        if self.seq_step >= len(self.active_harmonics_seq):
            self.overlay.clear_arrow()
            
            # Restore View Range
            if hasattr(self, 'pre_anim_view_range'):
                self.field_combined.setXRange(self.pre_anim_view_range[0][0], self.pre_anim_view_range[0][1], padding=0)
                self.field_combined.setYRange(self.pre_anim_view_range[1][0], self.pre_anim_view_range[1][1], padding=0)
            
            # Resume Playback
            if not self.is_playing:
                self.toggle_play()
                
            return

        item = self.active_harmonics_seq[self.seq_step]
        freq = item['freq']
        color = item['color']
        
        # Get FFT Position (Start)
        fft_point = QPointF(freq, 0) # Fallback
        
        # Try to find actual point in scatter plot
        scatter_points = self.fft_stem_markers.points()
        for p in scatter_points:
            if abs(p.pos().x() - freq) < 0.1:
                fft_point = p.pos()
                break
        
        # Map FFT point to global
        vb_fft = self.plot_fft.plotItem.vb
        scene_pos_fft = vb_fft.mapViewToScene(fft_point)
        view_pos_fft = self.plot_fft.mapFromScene(scene_pos_fft)
        global_pos_fft = self.plot_fft.mapToGlobal(view_pos_fft)
        local_pos_fft = self.overlay.mapFromGlobal(global_pos_fft) # Map to overlay, not self
        
        # Get Phasor Position (End)
        frame = self.slider.value()
        
        # Re-simulate the chain calculation
        # 1. H1 Pos
        vec_h1_pos = (0,0)
        s = 1.5 # Scaling factor
        
        if self.amp_pos_harmonics[0] > 0.001:
            angle = omega * t[frame]
            vec_h1_pos = (self.amp_pos_harmonics[0] * s * np.cos(angle), self.amp_pos_harmonics[0] * s * np.sin(angle))
            
        # 2. H1 Neg
        vec_h1_neg = (0,0)
        if self.amp_neg > 0.001:
            angle = -omega * t[frame]
            vec_h1_neg = (self.amp_neg * s * np.cos(angle), self.amp_neg * s * np.sin(angle))
            
        chain_vectors = []
        if self.amp_pos_harmonics[0] > 0.001: chain_vectors.append(vec_h1_pos)
        if self.amp_neg > 0.001: chain_vectors.append(vec_h1_neg)
        
        for i in range(1, 13):
            h_order = i + 1
            amp = self.amp_pos_harmonics[i]
            if amp > 0.001:
                rem = h_order % 3
                if rem == 1: # Pos
                    angle = h_order * omega * t[frame]
                    chain_vectors.append((amp * s * np.cos(angle), amp * s * np.sin(angle)))
                elif rem == 2: # Neg
                    angle = -h_order * omega * t[frame]
                    chain_vectors.append((amp * s * np.cos(angle), amp * s * np.sin(angle)))
        
        # Calculate position
        target_vec_start = (0, 0)
        target_vec_end = (0, 0)
        
        curr = (0, 0)
        found = False
        for i, vec in enumerate(chain_vectors):
            next_pos = (curr[0] + vec[0], curr[1] + vec[1])
            if i == item['index']: # Use stored index
                target_vec_start = curr
                target_vec_end = next_pos
                found = True
                break
            curr = next_pos
            
        # Midpoint of the vector
        phasor_point_x = (target_vec_start[0] + target_vec_end[0]) / 2
        phasor_point_y = (target_vec_start[1] + target_vec_end[1]) / 2
        phasor_point = QPointF(phasor_point_x, phasor_point_y)
        
        # Zoom to this vector
        # Calculate vector length
        vec_len = np.sqrt((target_vec_end[0] - target_vec_start[0])**2 + (target_vec_end[1] - target_vec_start[1])**2)
        zoom_span = max(vec_len * 3.0, 0.2) # Ensure minimum zoom
        
        self.field_combined.setXRange(phasor_point_x - zoom_span/2, phasor_point_x + zoom_span/2)
        self.field_combined.setYRange(phasor_point_y - zoom_span/2, phasor_point_y + zoom_span/2)
        
        # Force update to ensure coordinates are correct after zoom
        QApplication.processEvents()

        # Map Phasor point to global
        vb_field = self.field_combined.plotItem.vb
        scene_pos_field = vb_field.mapViewToScene(phasor_point)
        view_pos_field = self.field_combined.mapFromScene(scene_pos_field)
        global_pos_field = self.field_combined.mapToGlobal(view_pos_field)
        local_pos_field = self.overlay.mapFromGlobal(global_pos_field) # Map to overlay
        
        # Draw Arrow
        self.overlay.show_arrow(local_pos_fft, local_pos_field, color)
        self.overlay.raise_()
        
        # Schedule next step
        self.seq_step += 1
        QTimer.singleShot(2000, self.run_harmonics_step)

if __name__ == "__main__":
    app = QApplication(sys.argv)
    win = ClarkeFFTWidget()
    win.show()
    sys.exit(app.exec_())
