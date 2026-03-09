#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

if ! git rev-parse --show-toplevel >/dev/null 2>&1; then
  echo "Run this script from inside the Foundry git repository." >&2
  exit 1
fi

tracked_files="$(git ls-files)"
tracked_file_array=()
while IFS= read -r -d '' tracked_file; do
  tracked_file_array+=("$tracked_file")
done < <(git ls-files -z)

if [[ -z "$tracked_files" ]]; then
  echo "No tracked files to scan yet."
  exit 0
fi

disallowed_tracked_files="$(
  printf '%s\n' "$tracked_files" | rg --pcre2 '(^|/)\.env($|\.(?!example$|sample$|template$)[^/]+$)|\.pem$|\.key$|\.crt$|\.p12$|\.pfx$|\.mobileprovision$|\.dat$|\.db$|\.sqlite$|\.sqlite3$' || true
)"

if [[ -n "$disallowed_tracked_files" ]]; then
  echo "Refusing publish: credential or local-state files are tracked:" >&2
  printf '%s\n' "$disallowed_tracked_files" >&2
  exit 1
fi

heuristic_pattern='(?i)(BEGIN [A-Z ]+PRIVATE KEY|aws_access_key_id\s*[:=]\s*["'"'"']?[A-Z0-9]{16,}|aws_secret_access_key\s*[:=]\s*["'"'"']?[A-Za-z0-9/+=]{20,}|authorization\s*:\s*bearer\s+[A-Za-z0-9._-]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|ghp_[A-Za-z0-9]{20,}|glpat-[A-Za-z0-9_-]{20,}|\b(?:api|secret|client)[_-]?key\b\s*[:=]\s*["'"'"'][A-Za-z0-9/+=._-]{16,}["'"'"']|\b(?:api|auth|access|refresh|secret)[_-]?token\b\s*[:=]\s*["'"'"'][A-Za-z0-9/+=._-]{16,}["'"'"']|\bpassword\b\s*[:=]\s*["'"'"'][^"'"'"']{10,}["'"'"'])'
heuristic_path_allowlist='^services/foundry-core/app/(analytics/tests/|corporate/tests/|templates/zerver/integrations/|tools/build-release-tarball$|web/(e2e-tests|tests)/|zerver/migrations/0209_user_profile_no_empty_password.py$|zerver/tests/|zerver/webhooks/[^/]+/tests\.py$)'

heuristic_scan_files=()
for tracked_file in "${tracked_file_array[@]}"; do
  if [[ ! -e "$tracked_file" ]]; then
    continue
  fi
  if [[ "$tracked_file" =~ $heuristic_path_allowlist ]]; then
    continue
  fi
  heuristic_scan_files+=("$tracked_file")
done

heuristic_hits=""
if ((${#heuristic_scan_files[@]} > 0)); then
  heuristic_hits="$(
    rg -n --pcre2 "$heuristic_pattern" "${heuristic_scan_files[@]}" || true
  )"
fi

if [[ -n "$heuristic_hits" ]]; then
  echo "Refusing publish: potential secrets detected in tracked files:" >&2
  printf '%s\n' "$heuristic_hits" >&2
  exit 1
fi

if command -v gitleaks >/dev/null 2>&1; then
  # Scan the published Git content instead of local build artifacts like src-tauri/target.
  gitleaks git "$repo_root" --config "$repo_root/.gitleaks.toml" --platform github --no-banner --redact --exit-code 1
else
  echo "gitleaks not installed; heuristic secret scan passed."
fi

echo "Secret scan passed."
