#!/bin/bash
# Монтаж скринкаста: титр → 3 сцены с переходами → финальная карточка; фоновая музыка-подложка.
# Вход: video/raw/cuts.json (+ webm), video/cards/*.png. Выход: video/demo_1080.mp4, ../demo.mp4 (720p для PPTX), web/media/demo.mp4
set -e
cd "$(dirname "$0")"
FF=${FFMPEG:-/Users/tematarasov/Library/Python/3.9/lib/python/site-packages/imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v7.1}
python3 - <<'PY' > /tmp/radar_cut.txt
import json
C = {c["name"]: c for c in json.load(open("raw/cuts.json"))}
for n in ["s1_live", "s2_report", "s3_intern"]:
    c = C[n]; print(c["file"], max(0, c["start"] - 0.2), c["end"] - 0.3)
PY
i=0; INPUTS=(); FILTER=""
# титр и финал: по 3 с
INPUTS+=(-loop 1 -t 3 -i cards/title.png)
while read f a b; do INPUTS+=(-ss "$a" -to "$b" -i "$f"); done < /tmp/radar_cut.txt
INPUTS+=(-loop 1 -t 4 -i cards/end.png)
N=5
for k in $(seq 0 $((N-1))); do FILTER+="[$k:v]scale=1920:1080:flags=lanczos,fps=30,format=yuv420p,setsar=1[v$k];"; done
# длительности для xfade
D=(3); while read f a b; do D+=($(python3 -c "print(round($b-$a,2))")); done < /tmp/radar_cut.txt; D+=(4)
T=0.5; off=$(python3 -c "print(${D[0]}-$T)"); FILTER+="[v0][v1]xfade=transition=fade:duration=$T:offset=$off[x1];"
acc=$(python3 -c "print(${D[0]}+${D[1]}-$T)")
for k in 2 3 4; do off=$(python3 -c "print(round($acc-$T,2))"); FILTER+="[x$((k-1))][v$k]xfade=transition=fade:duration=$T:offset=$off[x$k];"; acc=$(python3 -c "print(round($acc+${D[$k]}-$T,2))"); done
TOTAL=$acc
# мягкая музыкальная подложка: аккорд из синусов с медленной огибающей
A="aevalsrc='0.06*sin(2*PI*220*t)*(0.6+0.4*sin(2*PI*0.25*t))+0.045*sin(2*PI*277.18*t)*(0.6+0.4*sin(2*PI*0.2*t+1))+0.04*sin(2*PI*329.63*t)*(0.6+0.4*sin(2*PI*0.17*t+2))+0.02*sin(2*PI*440*t)|0.06*sin(2*PI*220*t)*(0.6+0.4*sin(2*PI*0.23*t))+0.045*sin(2*PI*277.18*t)*(0.6+0.4*sin(2*PI*0.19*t+1))+0.04*sin(2*PI*329.63*t)*(0.6+0.4*sin(2*PI*0.15*t+2))+0.02*sin(2*PI*440*t+0.5)':s=48000:d=$TOTAL,afade=t=in:d=1.5,afade=t=out:st=$(python3 -c "print($TOTAL-2)"):d=2,lowpass=f=1800,aecho=0.8:0.7:60:0.25[a]"
"$FF" -y -loglevel error "${INPUTS[@]}" -filter_complex "${FILTER}${A}" -map "[x4]" -map "[a]" \
  -c:v libx264 -preset medium -crf 21 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart demo_1080.mp4
"$FF" -y -loglevel error -i demo_1080.mp4 -vf scale=1280:720:flags=lanczos -c:v libx264 -preset medium -b:v 1400k -maxrate 1800k -bufsize 2800k \
  -c:a aac -b:a 96k -movflags +faststart ../demo.mp4
mkdir -p ../../../web/media && cp ../demo.mp4 ../../../web/media/demo.mp4
"$FF" -y -loglevel error -ss 9 -i demo_1080.mp4 -frames:v 1 -q:v 3 ../shots/demo_poster.jpg
ls -la demo_1080.mp4 ../demo.mp4; echo "total ${TOTAL}s"
