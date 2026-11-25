"""Дашборд для HR. Запуск: streamlit run app/dashboard.py"""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd
import plotly.express as px
import streamlit as st

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from feedback import ingest, pipeline  # noqa: E402
from feedback.config import ROOT, settings  # noqa: E402
from feedback.taxonomy import title  # noqa: E402

SAMPLE = ROOT / "data" / "sample" / "feedback.csv"
SENT_COLORS = {"positive": "#2e9e5b", "neutral": "#9aa0a6", "mixed": "#e0a030", "negative": "#d64545"}
SENT_RU = {"positive": "позитив", "neutral": "нейтрально", "mixed": "смешанно", "negative": "негатив"}
ROLE_RU = {"intern": "стажёр", "mentor": "наставник", "unknown": "—"}

st.set_page_config(page_title="Код города · обратная связь", layout="wide")
st.title("Анализ обратной связи стажёров и наставников")


@st.cache_data(show_spinner="Анализируем отзывы…")
def analyze(data: bytes, name: str):
    items = ingest.load(data, filename=name)
    res = pipeline.run(items)
    return res.df, res.stats, res.insights.model_dump(), res.engine


with st.sidebar:
    st.caption(f"Движок: **{'Claude · ' + settings.model if settings.use_claude() else 'офлайн-правила'}**")
    up = st.file_uploader("Файл с отзывами", type=["csv", "xlsx", "xls", "json", "jsonl"])
    if up is None:
        st.info("Файл не выбран — показываем демо-данные.")
        data, name = SAMPLE.read_bytes(), SAMPLE.name
    else:
        data, name = up.getvalue(), up.name

df, stats, insights, engine = analyze(data, name)

with st.sidebar:
    roles = st.multiselect("Роль автора", sorted(df["role"].unique()), format_func=ROLE_RU.get)
    deps = st.multiselect("Подразделение", sorted(df["department"].dropna().unique()))
    topics_all = sorted({t for ts in df["topics"] for t in ts})
    topics = st.multiselect("Тема", topics_all, format_func=title)

f = df.copy()
if roles:
    f = f[f["role"].isin(roles)]
if deps:
    f = f[f["department"].isin(deps)]
if topics:
    f = f[f["topics"].apply(lambda ts: any(t in ts for t in topics))]

c = st.columns(5)
c[0].metric("Отзывов", len(f))
c[1].metric("Средняя тональность", f"{f['score'].mean():+.2f}" if len(f) else "—")
c[2].metric("Негативных", int((f["sentiment"] == "negative").sum()))
c[3].metric("Срочных", int((f["urgency"] == "high").sum()))
c[4].metric("Риск ухода", int(f["churn_risk"].sum()))

tab_sum, tab_topics, tab_people, tab_alerts, tab_all = st.tabs(
    ["Выводы", "Темы", "Наставники и стажёры", "Требуют внимания", "Все отзывы"])

with tab_sum:
    st.subheader(insights["headline"])
    a, b, c3 = st.columns(3)
    for col, head, key in [(a, "Ключевые выводы", "key_findings"), (b, "Риски", "risks"),
                           (c3, "Рекомендации", "recommendations")]:
        col.markdown(f"**{head}**")
        col.markdown("\n".join(f"- {x}" for x in insights[key]))
    left, right = st.columns(2)
    sc = f["sentiment"].value_counts().rename_axis("sentiment").reset_index(name="n")
    sc["label"] = sc["sentiment"].map(SENT_RU)
    left.plotly_chart(px.pie(sc, names="label", values="n", color="sentiment", color_discrete_map=SENT_COLORS,
                             hole=0.5, title="Тональность"), use_container_width=True)
    if f["date"].notna().any():
        tl = f.dropna(subset=["date"]).set_index("date").resample("W")["score"].mean().reset_index()
        right.plotly_chart(px.line(tl, x="date", y="score", markers=True, title="Тональность по неделям"),
                           use_container_width=True)

with tab_topics:
    t = f.explode("topics").dropna(subset=["topics"])
    if len(t):
        g = t.groupby("topics").agg(n=("id", "count"), score=("score", "mean")).reset_index()
        g["тема"] = g["topics"].map(title)
        st.plotly_chart(px.bar(g.sort_values("n"), x="n", y="тема", orientation="h", color="score",
                               color_continuous_scale="RdYlGn", range_color=[-1, 1],
                               title="Упоминания тем (цвет — средняя тональность)"), use_container_width=True)
        pr = f.explode("problems").dropna(subset=["problems"])
        st.markdown("**Проблемы, которые называют чаще всего**")
        st.dataframe(pr[["role", "department", "problems"]].rename(columns={"problems": "проблема"}),
                     use_container_width=True, hide_index=True)

with tab_people:
    l, r = st.columns(2)
    for col, head, key in [(l, "Наставники (по отзывам стажёров)", "intern"),
                           (r, "Стажёры (по отзывам наставников)", "mentor")]:
        sub = f[(f["role"] == key) & f["subject"].notna()]
        col.markdown(f"**{head}**")
        if len(sub):
            g = sub.groupby("subject").agg(отзывов=("id", "count"), тональность=("score", "mean"),
                                           срочных=("urgency", lambda s: (s == "high").sum()))
            col.dataframe(g.sort_values("тональность").round(2), use_container_width=True)
        else:
            col.caption("Нет данных о том, о ком отзыв.")

with tab_alerts:
    al = f[(f["urgency"] == "high") | f["churn_risk"]].sort_values("score")
    if al.empty:
        st.success("Срочных отзывов нет.")
    for _, row in al.iterrows():
        with st.expander(f"{'🔴' if row['urgency'] == 'high' else '🟠'} {row['summary']}"):
            st.write(row["text"])
            st.caption(f"{ROLE_RU[row['role']]} · {row['author'] or '—'} → {row['subject'] or '—'} · "
                       f"{row['department'] or '—'} · тональность {row['score']:+.2f}")
            if row["problems"]:
                st.markdown("**Проблемы:** " + "; ".join(row["problems"]))
            if row["suggestions"]:
                st.markdown("**Предложения:** " + "; ".join(row["suggestions"]))

with tab_all:
    show = f.copy()
    show["topics"] = show["topics"].apply(lambda ts: ", ".join(title(t) for t in ts))
    show["sentiment"] = show["sentiment"].map(SENT_RU)
    st.dataframe(show[["id", "date", "role", "subject", "department", "sentiment", "score", "urgency",
                       "topics", "summary", "text"]], use_container_width=True, hide_index=True)
    st.download_button("Скачать разметку CSV", f.to_csv(index=False).encode("utf-8-sig"),
                       "analysis.csv", "text/csv")
