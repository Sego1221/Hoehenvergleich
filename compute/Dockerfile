# Höhenvergleich Compute-Service (FastAPI). Build-Kontext = compute/
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    MPLBACKEND=Agg

# rasterio/laspy bringen Wheels mit GDAL; nur minimale Runtime-Libs noetig.
# libtbb12 + libgomp1: Runtime-Abhaengigkeiten des PotreeConverter-2.x-Binaries.
# curl/ca-certificates: Download des PotreeConverter-Release; unzip: entpacken.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libexpat1 libtbb12 libgomp1 curl ca-certificates unzip && \
    rm -rf /var/lib/apt/lists/*

# PotreeConverter 2.x (prebuilt Linux-x64-Release von GitHub) installieren.
# Erzeugt Potree-2.0-Octrees (metadata.json/hierarchy.bin/octree.bin).
ARG POTREE_URL=https://github.com/potree/PotreeConverter/releases/download/2.1.1/PotreeConverter_linux_x64.zip
RUN mkdir -p /opt/potree && \
    curl -fsSL "$POTREE_URL" -o /tmp/potree.zip && \
    unzip -o /tmp/potree.zip -d /opt/potree && \
    rm /tmp/potree.zip && \
    BIN="$(find /opt/potree -name PotreeConverter -type f | head -n1)" && \
    chmod +x "$BIN" && ln -sf "$BIN" /usr/local/bin/PotreeConverter
ENV HV_POTREE_BIN=/usr/local/bin/PotreeConverter

WORKDIR /srv
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .

EXPOSE 8000
# Railway liefert $PORT; lokal Default 8000.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
