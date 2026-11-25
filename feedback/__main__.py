"""CLI: python -m feedback data/sample/feedback.csv -o out/"""
from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path

from . import ingest, pipeline


def main() -> None:
    p = argparse.ArgumentParser(description="Анализ обратной связи стажёров и наставников")
    p.add_argument("input", type=Path, help="CSV / XLSX / JSON с отзывами")
    p.add_argument("-o", "--out", type=Path, default=Path("out"), help="папка для результатов")
    p.add_argument("--no-insights", action="store_true", help="не строить итоговый отчёт")
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    items = ingest.load(args.input)
    print(f"Загружено отзывов: {len(items)}")
    res = pipeline.run(items, with_insights=not args.no_insights)

    args.out.mkdir(parents=True, exist_ok=True)
    res.df.to_csv(args.out / "analysis.csv", index=False)
    res.alerts.to_csv(args.out / "alerts.csv", index=False)
    (args.out / "stats.json").write_text(json.dumps(res.stats, ensure_ascii=False, indent=2, default=str))
    (args.out / "insights.json").write_text(res.insights.model_dump_json(indent=2))

    print(f"Движок: {res.engine}")
    print(f"\n{res.insights.headline}")
    for section, lines in [("Выводы", res.insights.key_findings), ("Риски", res.insights.risks),
                           ("Рекомендации", res.insights.recommendations)]:
        print(f"\n{section}:")
        for line in lines:
            print(f"  • {line}")
    print(f"\nРезультаты: {args.out}/")


if __name__ == "__main__":
    main()
