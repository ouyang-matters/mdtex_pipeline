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
# full-sorted (review follow-up) is a variant of the full-id baseline: same hue,
# dashed line, hollow square -- no ninth palette slot.
COLOR["full-sorted"] = COLOR["full-id"]
MARKER["full-sorted"] = "s"
LINESTYLE = {"full-sorted": (0, (3.5, 1.6))}
HOLLOW = {"full-sorted"}
# legend / plotting order: dynamic methods first, then static baselines
ORDER = ["mmhm", "mmhm-norb", "drb-id-rb", "drb-id", "full-id", "full-sorted", "full-morse", "gudhi",
         "euler"]

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
        "mathtext.fontset": "custom",
        "mathtext.rm": "Liberation Sans",
        "mathtext.it": "Liberation Sans:italic",
        "mathtext.bf": "Liberation Sans:bold",
        "mathtext.sf": "Liberation Sans",
        "mathtext.cal": "Liberation Sans:italic",
        "mathtext.tt": "Liberation Sans",
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
    if m in HOLLOW:
        return ax.plot(x, y, color=COLOR[m], marker=MARKER[m], ls=LINESTYLE.get(m, "-"),
                       mfc="white", mec=COLOR[m], markeredgewidth=1.0,
                       label=label if label is not None else m, **kw)
    return ax.plot(x, y, color=COLOR[m], marker=MARKER[m], markeredgecolor="white",
                   markeredgewidth=0.6, ls=LINESTYLE.get(m, "-"),
                   label=label if label is not None else m, **kw)


def legend_handle(m):
    from matplotlib.lines import Line2D
    if m in HOLLOW:
        return Line2D([], [], color=COLOR[m], marker=MARKER[m], ls=LINESTYLE.get(m, "-"),
                      mfc="white", mec=COLOR[m], mew=1.0, label=m)
    return Line2D([], [], color=COLOR[m], marker=MARKER[m], mec="white", mew=0.6, label=m)


def band(ax, x, lo, hi, m):
    ax.fill_between(x, lo, hi, color=COLOR[m], alpha=0.12, lw=0)


def compact(v):
    """1, 2, 5, 10, ..., 1k, 2k, 10k, 1M, 0.5 -- plain tick labels."""
    if v >= 1e6:
        s = f"{v / 1e6:g}M"
    elif v >= 1e3:
        s = f"{v / 1e3:g}k"
    else:
        s = f"{v:g}"
    return s


def log_axis(ax, which="y"):
    """Log scale with plain compact labels. Spans of up to ~1.5 decades also
    label the 2x and 5x minor ticks so every panel has readable ticks."""
    from matplotlib.ticker import FuncFormatter, LogLocator, NullFormatter
    axis = ax.yaxis if which == "y" else ax.xaxis
    lo, hi = (ax.get_ylim() if which == "y" else ax.get_xlim())
    span = (hi / lo) if lo > 0 else 1e9
    axis.set_major_locator(LogLocator(base=10, numticks=12))
    fmt = FuncFormatter(lambda v, _: compact(v))
    axis.set_major_formatter(fmt)
    if span <= 40:
        axis.set_minor_locator(LogLocator(base=10, subs=(2.0, 5.0), numticks=12))
        axis.set_minor_formatter(fmt)
    else:
        axis.set_minor_locator(LogLocator(base=10, subs=tuple(range(2, 10)), numticks=12))
        axis.set_minor_formatter(NullFormatter())


def missing_note(fig, exps, workload_pred=None, methods=None, y=-0.01):
    """Marks missing data instead of dropping it silently: if results/NOT_RUN.csv
    lists runs of these experiments (optionally filtered by workload and
    method), a footnote under the figure names them. Returns the list."""
    import pandas as pd
    path = os.path.join(RES, "NOT_RUN.csv")
    if not os.path.exists(path):
        return []
    nr = pd.read_csv(path)
    nr = nr[nr.exp.isin(exps)]
    if nr.empty:
        return []
    if workload_pred is not None:
        nr = nr[nr.workload.map(workload_pred)]
    if methods is not None:
        nr = nr[nr.method.isin(methods)]
    if nr.empty:
        return []
    items = []
    for (w, m), g in nr.groupby(["workload", "method"]):
        items.append(f"{m} @ {w} (seed {','.join(str(x) for x in sorted(g.seed))})")
    txt = "Missing runs (experiments/results/NOT_RUN.csv): " + "; ".join(items)
    import textwrap
    fig.text(0.0, y, "\n".join(textwrap.wrap(txt, 150)), fontsize=6, color=INK2, ha="left",
             va="top")
    return items


def save(fig, name):
    path = os.path.join(HERE, name + ".pdf")
    fig.savefig(path, metadata={"CreationDate": None, "ModDate": None})
    plt.close(fig)
    print("wrote", path)
