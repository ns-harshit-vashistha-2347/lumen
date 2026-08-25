# syntax=docker/dockerfile:1.7

# ---------- deps stage: only rebuilds when requirements change ----------
FROM python:3.11-slim AS deps

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.in .

# BuildKit cache mount: pip's download/wheel cache persists across builds
# even when requirements.in changes, so only *new* packages get downloaded
# instead of re-downloading everything every time.
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.in

# ---------- runtime stage: slim, no build tools, code copied last ----------
FROM python:3.11-slim AS runtime

WORKDIR /app

# only runtime deps, not build-essential/git (those were only needed to build wheels)
RUN apt-get update && apt-get install -y --no-install-recommends git \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=deps /usr/local/bin /usr/local/bin

# code copied last - changing app code no longer invalidates the pip install layer above
COPY . .

EXPOSE 8080