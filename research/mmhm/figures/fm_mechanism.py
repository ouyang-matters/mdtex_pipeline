#!/usr/bin/env python3
"""Main-text figure: basis growth and rebuilds over time, W2 (no growth, no
rebuild) against W3 (growth, rebuilds). The same plot as F4 (f4_time_series.py,
supplement) restricted to its first two columns; seed 0, default policy.
"""
import f4_time_series as F4

if __name__ == "__main__":
    F4.main(cols=F4.COLS[:2], name="FM2_basis_and_rebuilds", width=F4.S.TEXTWIDTH * 0.82,
            height=3.6)
