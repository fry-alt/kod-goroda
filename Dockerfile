# API «Код города» для сервера Yapp (Timeweb). Собирает GitHub Actions (.github/workflows/deploy.yml).
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

# Streamlit, plotly и pytest API не нужны — не тащим их на сервер (диск 14 ГБ на двоих с Yapp)
COPY requirements.txt .
RUN grep -viE '^(streamlit|plotly|pytest)' requirements.txt > req.txt && pip install -r req.txt

COPY api api
COPY feedback feedback
COPY data/case data/case
COPY data/knowledge data/knowledge
COPY web web
COPY docs/case_full.md docs/surveys_structure.md docs/

# База SQLite — в томе /app/state, чтобы ответы из форм переживали перезапуск и выкладку
ENV DB_PATH=/app/state/app.db
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
