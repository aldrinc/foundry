ARG CODER_RUNTIME_IMAGE=ghcr.io/coder/coder:v2.31.3

FROM ${CODER_RUNTIME_IMAGE}

COPY coder /opt/coder

ENTRYPOINT ["/opt/coder", "server"]
