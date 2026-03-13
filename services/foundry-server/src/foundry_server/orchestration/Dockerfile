FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

ARG CODEX_CLI_VERSION=0.111.0
ARG CLAUDE_CODE_VERSION=2.1.70
ARG BUN_VERSION=1.2.23

ENV BUN_INSTALL=/root/.bun \
    PATH=/root/.bun/bin:${PATH}

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates curl jq nodejs npm ripgrep cargo unzip \
    && curl -fsSL https://bun.sh/install | bash -s -- bun-v${BUN_VERSION} \
    && npm install -g @openai/codex@${CODEX_CLI_VERSION} @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt pre-commit

COPY ./*.py ./
COPY ./orchestrator_policy.yaml ./orchestrator_policy.yaml
COPY ./supervisor ./supervisor
COPY ./supervisor_runtime ./supervisor_runtime

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8090"]
