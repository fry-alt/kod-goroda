#!/bin/bash
# Рендер презентации: PNG каждого слайда (out/slide-N.png) и PDF (out/deck.pdf).
# ./render.sh [final]  — final убирает оранжевый пунктир «доделать»
cd "$(dirname "$0")"; mkdir -p out
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
F=""; [ "$1" = final ] && F="&final"
U="file://$PWD/deck.html"
N=$(grep -c '<section class="s' deck.html)
for i in $(seq 1 $N); do
  "$CH" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files --virtual-time-budget=4000 \
    --window-size=1920,1080 --screenshot="$PWD/out/slide-$i.png" "$U?s=$i$F" 2>/dev/null
done
"$CH" --headless=new --disable-gpu --allow-file-access-from-files --virtual-time-budget=4000 --no-pdf-header-footer \
  --print-to-pdf="$PWD/out/deck.pdf" "$U?x=1$F" 2>/dev/null
ls out
