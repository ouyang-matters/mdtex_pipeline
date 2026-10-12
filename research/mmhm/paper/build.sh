#!/bin/sh
# Build the paper, its supplement and the separate erratum. The main paper and
# the supplement reference each other through xr, so they are built in turns.
set -e
cd "$(dirname "$0")"
latexmk -pdf -interaction=nonstopmode main.tex
latexmk -pdf -interaction=nonstopmode supplement.tex
latexmk -pdf -g -interaction=nonstopmode main.tex
latexmk -pdf -g -interaction=nonstopmode supplement.tex
latexmk -pdf -interaction=nonstopmode MMHM_v1_erratum.tex
