FROM ubuntu:22.04

ENV OLLAMA_VERSION=0.5.1

RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    wget \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://ollama.ai/install.sh | sh

ENV OLLAMA_MODELS=/models

RUN ollama pull tinyllama

COPY models/ /models/
COPY docker/api/ /app/

WORKDIR /app

EXPOSE 11434 8000

CMD ["sh", "-c", "ollama serve & python3 -m http.server 8000"]