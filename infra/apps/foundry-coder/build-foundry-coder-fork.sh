#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <output-binary-path>" >&2
  exit 1
fi

OUTPUT_BINARY="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UPSTREAM_REF="${CODER_UPSTREAM_REF:-v2.31.3}"
UPSTREAM_REPOSITORY="${CODER_UPSTREAM_REPOSITORY:-https://github.com/coder/coder.git}"
GO_VERSION="${GO_VERSION:-1.25.7}"
NODE_VERSION="${NODE_VERSION:-22.14.0}"
PATCH_FILE="${SCRIPT_DIR}/coder-agpl-org-create.patch"
PROVISIONERS_PATCH_FILE="${SCRIPT_DIR}/coder-agpl-provisioners.patch"
BUILD_ROOT="${FOUNDRY_CODER_BUILD_ROOT:-/opt/foundry/build/foundry-coder}"
GO_ROOT="/opt/foundry/tools/go-${GO_VERSION}"
NODE_ROOT="/opt/foundry/tools/node-v${NODE_VERSION}"
SOURCE_DIR="${BUILD_ROOT}/source"

for patch_file in "${PATCH_FILE}" "${PROVISIONERS_PATCH_FILE}"; do
  if [[ ! -f "${patch_file}" ]]; then
    echo "missing patch file: ${patch_file}" >&2
    exit 1
  fi
done

mkdir -p "${BUILD_ROOT}" "$(dirname "${OUTPUT_BINARY}")" /opt/foundry/tools

if [[ ! -x "${GO_ROOT}/bin/go" ]]; then
  archive="/tmp/go${GO_VERSION}.linux-amd64.tar.gz"
  curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" -o "${archive}"
  rm -rf "${GO_ROOT}"
  mkdir -p "${GO_ROOT}"
  tar -C "${GO_ROOT}" --strip-components=1 -xzf "${archive}"
  rm -f "${archive}"
fi

if [[ ! -x "${NODE_ROOT}/bin/node" ]]; then
  archive="/tmp/node-v${NODE_VERSION}-linux-x64.tar.xz"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" -o "${archive}"
  rm -rf "${NODE_ROOT}"
  mkdir -p "${NODE_ROOT}"
  tar -C "${NODE_ROOT}" --strip-components=1 -xJf "${archive}"
  rm -f "${archive}"
fi

export PATH="${NODE_ROOT}/bin:${GO_ROOT}/bin:${PATH}"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}"

ensure_go_tool() {
  local binary="$1"
  local package_ref="$2"
  if [[ ! -x "${GO_ROOT}/bin/${binary}" ]]; then
    GOBIN="${GO_ROOT}/bin" CGO_ENABLED=1 go install "${package_ref}"
  fi
}

ensure_go_tool sqlc github.com/coder/sqlc/cmd/sqlc@aab4e865a51df0c43e1839f81a9d349b41d14f05
ensure_go_tool mockgen go.uber.org/mock/mockgen@v0.6.0
ensure_go_tool protoc-gen-go google.golang.org/protobuf/cmd/protoc-gen-go@v1.30.0
ensure_go_tool protoc-gen-go-drpc storj.io/drpc/cmd/protoc-gen-go-drpc@v0.0.34

if ! command -v protoc >/dev/null 2>&1; then
  apt-get update
  apt-get install -y protobuf-compiler
fi

if [[ ! -d "${SOURCE_DIR}/.git" ]]; then
  git clone --depth=1 --branch "${UPSTREAM_REF}" "${UPSTREAM_REPOSITORY}" "${SOURCE_DIR}"
fi

git -C "${SOURCE_DIR}" fetch --depth=1 origin "refs/tags/${UPSTREAM_REF}:refs/tags/${UPSTREAM_REF}"
git -C "${SOURCE_DIR}" checkout --detach "${UPSTREAM_REF}"
git -C "${SOURCE_DIR}" reset --hard "${UPSTREAM_REF}"
git -C "${SOURCE_DIR}" clean -fdx
git -C "${SOURCE_DIR}" apply "${PATCH_FILE}"
git -C "${SOURCE_DIR}" apply "${PROVISIONERS_PATCH_FILE}"

corepack enable

(
  cd "${SOURCE_DIR}"
  make build/coder_linux_amd64
)

BUILT_BINARY=""
if [[ -x "${SOURCE_DIR}/build/coder_linux_amd64" ]]; then
  BUILT_BINARY="${SOURCE_DIR}/build/coder_linux_amd64"
else
  shopt -s nullglob
  slim_binaries=("${SOURCE_DIR}"/build/coder-slim_*_linux_amd64)
  shopt -u nullglob
  if [[ ${#slim_binaries[@]} -eq 0 ]]; then
    echo "unable to locate built Coder binary under ${SOURCE_DIR}/build" >&2
    exit 1
  fi
  BUILT_BINARY="${slim_binaries[0]}"
fi

install -m 755 "${BUILT_BINARY}" "${OUTPUT_BINARY}"
