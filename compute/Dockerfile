# Höhenvergleich Compute-Service (FastAPI). Build-Kontext = compute/
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    MPLBACKEND=Agg

# rasterio/laspy bringen Wheels mit GDAL; nur minimale Runtime-Libs noetig.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libexpat1 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .

EXPOSE 8000
# Railway liefert $PORT; lokal Default 8000.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
