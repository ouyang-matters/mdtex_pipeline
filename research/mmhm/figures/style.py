"""Shared figure style: one colour and one marker per method in every figure.

Colours are the eight slots of the validated categorical palette, in slot
order (each method keeps its slot in every figure, whatever subset a figure
shows). Checked with the palette validator on the white page surface: adjacent
pairs CVD dE >= 9.1, normal-vision dE >= 19.6; three slots (aqua, yellow,
magenta) are below 3:1 contrast on white, so every figure carries a legend and
each method also has its own marker shape (secondary encoding for print and
colour-vision deficiency).
"""

import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RES = os.path.join(ROOT, "experiments", "results")

TEXTWIDTH = 6.3  # inches (single-column paper)

METHODS = ["mmhm", "drb-id", "mmhm-norb", "drb-id-rb", "full-id", "full-morse", "gudhi", "euler"]
COLOR = {
    "mmhm": "#2a78d6",        # slot 1 blue
    "drb-id": "#eb6834",      # slot 2 orange
    "mmhm-norb": "#1baf7a",   # slot 3 aqua
    "drb-id-rb": "#eda100",   # slot 4 yellow
    "full-id": "#e87ba4",     # slot 5 magenta
    "full-morse": "#008300",  # slot 6 green
    "gudhi": "#6250d6",       # slot 7 violet
    "euler": "#e34948",       # slot 8 red
}
MARKER = {"mmhm": "o", "drb-id": "^", "mmhm-norb": "h", "drb-id-rb": "v", "full-id": "s",
          "full-morse": "D", "gudhi": "P", "euler": "X"}
# legend / plotting order: dynamic methods first, then static baselines
ORDER = ["mmhm", "mmhm-norb", "drb-id-rb", "drb-id", "full-id", "full-morse", "gudhi", "euler"]

INK = "#0b0b0b"
INK2 = "#52514e"
MUTED = "#898781"
GRID = "#e1e0d9"
AXIS = "#c3c2b7"


def setup():
    plt.rcParams.update({
        "font.family": "sans-serif",
        "font.sans-serif": ["Liberation Sans", "Arial", "Helvetica", "DejaVu Sans"],
        "font.size": 8,
        "axes.titlesize": 8.5,
        "axes.labelsize": 8,
        "xtick.labelsize": 7.5,
        "ytick.labelsize": 7.5,
        "legend.fontsize": 7.5,
        "axes.edgecolor": AXIS,
        "axes.linewidth": 0.6,
        "axes.labelcolor": INK,
        "axes.titlecolor": INK,
        "xtick.color": INK2,
        "ytick.color": INK2,
        "xtick.major.width": 0.6,
        "ytick.major.width": 0.6,
        "xtick.minor.width": 0.4,
        "ytick.minor.width": 0.4,
        "xtick.major.size": 3,
        "ytick.major.size": 3,
        "xtick.minor.size": 1.8,
        "ytick.minor.size": 1.8,
        "axes.grid": True,
        "axes.grid.which": "major",
        "grid.color": GRID,
        "grid.linewidth": 0.5,
        "grid.linestyle": "-",
        "axes.spines.top": False,
        "axes.spines.right": False,
        "lines.linewidth": 1.4,
        "lines.markersize": 4.5,
        "legend.frameon": False,
        "pdf.fonttype": 42,
        "ps.fonttype": 42,
        "savefig.bbox": "tight",
        "savefig.pad_inches": 0.02,
        "figure.dpi": 150,
    })


def method_line(ax, x, y, m, label=None, **kw):
    """Line + markers for method m, with a white ring around markers."""
    kw.setdefault("lw", 1.4)
    kw.setdefault("ms", 4.5)
    return ax.plot(x, y, color=COLOR[m], marker=MARKER[m], markeredgecolor="white",
                   markeredgewidth=0.6, label=label if label is not None else m, **kw)


def band(ax, x, lo, hi, m):
    ax.fill_between(x, lo, hi, color=COLOR[m], alpha=0.12, lw=0)


def save(fig, name):
    path = os.path.join(HERE, name + ".pdf")
    fig.savefig(path)
    plt.close(fig)
    print("wrote", path)
