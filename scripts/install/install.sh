#!/bin/sh

set -eu

VERSION="${1:-latest}"
INSTALL_BIN_DIR="${FEYNMAN_INSTALL_BIN_DIR:-$HOME/.local/bin}"
INSTALL_APP_DIR="${FEYNMAN_INSTALL_APP_DIR:-$HOME/.local/share/feynman}"
SKIP_PATH_UPDATE="${FEYNMAN_INSTALL_SKIP_PATH_UPDATE:-0}"
path_action="already"
path_profile=""

step() {
  printf '==> %s\n' "$1"
}

run_with_spinner() {
  label="$1"
  shift

  if [ ! -t 2 ]; then
    step "$label"
    "$@"
    return
  fi

  "$@" &
  pid=$!
  frame=0

  set +e
  while kill -0 "$pid" 2>/dev/null; do
    case "$frame" in
      0) spinner='|' ;;
      1) spinner='/' ;;
      2) spinner='-' ;;
      *) spinner='\\' ;;
    esac
    printf '\r==> %s %s' "$label" "$spinner" >&2
    frame=$(( (frame + 1) % 4 ))
    sleep 0.1
  done
  wait "$pid"
  status=$?
  set -e

  printf '\r\033[2K' >&2
  if [ "$status" -ne 0 ]; then
    printf '==> %s failed\n' "$label" >&2
    return "$status"
  fi

  step "$label"
}

normalize_version() {
  case "$1" in
    "")
      printf 'latest\n'
      ;;
    latest | stable)
      printf 'latest\n'
      ;;
    edge)
      echo "The edge channel has been removed. Use the default installer for the latest tagged release or pass an exact version." >&2
      exit 1
      ;;
    v*)
      printf '%s\n' "${1#v}"
      ;;
    *)
      printf '%s\n' "$1"
      ;;
  esac
}

download_file() {
  url="$1"
  output="$2"

  if command -v curl >/dev/null 2>&1; then
    if [ -t 2 ]; then
      curl -fL --progress-bar "$url" -o "$output"
    else
      curl -fsSL "$url" -o "$output"
    fi
    return
  fi

  if command -v wget >/dev/null 2>&1; then
    if [ -t 2 ]; then
      wget --show-progress -O "$output" "$url"
    else
      wget -q -O "$output" "$url"
    fi
    return
  fi

  echo "curl or wget is required to install Feynman." >&2
  exit 1
}

download_text() {
  url="$1"

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url"
    return
  fi

  if command -v wget >/dev/null 2>&1; then
    wget -q -O - "$url"
    return
  fi

  echo "curl or wget is required to install Feynman." >&2
  exit 1
}

add_to_path() {
  path_action="already"
  path_profile=""

  case ":$PATH:" in
    *":$INSTALL_BIN_DIR:"*)
      return
      ;;
  esac

  if [ "$SKIP_PATH_UPDATE" = "1" ]; then
    path_action="skipped"
    return
  fi

  profile="${FEYNMAN_INSTALL_SHELL_PROFILE:-$HOME/.profile}"
  if [ -z "${FEYNMAN_INSTALL_SHELL_PROFILE:-}" ]; then
    case "${SHELL:-}" in
      */zsh)
        profile="$HOME/.zshrc"
        ;;
      */bash)
        profile="$HOME/.bashrc"
        ;;
    esac
  fi

  path_profile="$profile"
  path_line="export PATH=\"$INSTALL_BIN_DIR:\$PATH\""
  if [ -f "$profile" ] && grep -F "$path_line" "$profile" >/dev/null 2>&1; then
    path_action="configured"
    return
  fi

  {
    printf '\n# Added by Feynman installer\n'
    printf '%s\n' "$path_line"
  } >>"$profile"
  path_action="added"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "$1 is required to install Feynman." >&2
    exit 1
  fi
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
    return
  fi
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
    return
  fi
  echo "sha256sum or shasum is required to verify the Feynman download." >&2
  exit 1
}

warn_command_conflict() {
  expected_path="$INSTALL_BIN_DIR/feynman"
  resolved_path="$(command -v feynman 2>/dev/null || true)"

  if [ -z "$resolved_path" ]; then
    return
  fi

  if [ "$resolved_path" != "$expected_path" ]; then
    step "Warning: current shell resolves feynman to $resolved_path"
    step "Run now: export PATH=\"$INSTALL_BIN_DIR:\$PATH\" && hash -r && feynman"
    step "Or launch directly: $expected_path"

    step "If that path is an old package-manager install, remove it or put $INSTALL_BIN_DIR first on PATH."
  fi
}

resolve_release_metadata() {
  normalized_version="$(normalize_version "$VERSION")"

  if [ "$normalized_version" = "latest" ]; then
    release_page="$(download_text "https://github.com/advaitpaliwal/feynman/releases/latest")"
    resolved_version="$(printf '%s\n' "$release_page" | sed -n 's@.*releases/tag/v\([0-9][^"<>[:space:]]*\).*@\1@p' | head -n 1)"

    if [ -z "$resolved_version" ]; then
      echo "Failed to resolve the latest Feynman release version." >&2
      exit 1
    fi
  else
    resolved_version="$normalized_version"
  fi

  bundle_name="feynman-${resolved_version}-${asset_target}"
  archive_name="${bundle_name}.${archive_extension}"
  release_base_url="${FEYNMAN_INSTALL_BASE_URL:-https://github.com/advaitpaliwal/feynman/releases/download/v${resolved_version}}"
  download_url="${release_base_url}/${archive_name}"
  checksums_url="${release_base_url}/SHA256SUMS"

  printf '%s\n%s\n%s\n%s\n%s\n' "$resolved_version" "$bundle_name" "$archive_name" "$download_url" "$checksums_url"
}

case "$(uname -s)" in
  Darwin)
    os="darwin"
    ;;
  Linux)
    os="linux"
    ;;
  *)
    echo "install.sh supports macOS and Linux. Use install.ps1 on Windows." >&2
    exit 1
    ;;
esac

case "$(uname -m)" in
  x86_64 | amd64)
    arch="x64"
    ;;
  arm64 | aarch64)
    arch="arm64"
    ;;
  *)
    echo "Unsupported architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

require_command mktemp
require_command tar

asset_target="$os-$arch"
archive_extension="tar.gz"
release_metadata="$(resolve_release_metadata)"
resolved_version="$(printf '%s\n' "$release_metadata" | sed -n '1p')"
bundle_name="$(printf '%s\n' "$release_metadata" | sed -n '2p')"
archive_name="$(printf '%s\n' "$release_metadata" | sed -n '3p')"
download_url="$(printf '%s\n' "$release_metadata" | sed -n '4p')"
checksums_url="$(printf '%s\n' "$release_metadata" | sed -n '5p')"

step "Installing Feynman ${resolved_version} for ${asset_target}"

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT INT TERM

archive_path="$tmp_dir/$archive_name"
step "Downloading ${archive_name}"
if ! download_file "$download_url" "$archive_path"; then
  cat >&2 <<EOF
Failed to download ${archive_name} from:
  ${download_url}

The ${asset_target} bundle is missing from the GitHub release.
This usually means the release exists, but not all platform bundles were uploaded.

Workarounds:
  - try again after the release finishes publishing
  - pass the latest published version explicitly, e.g.:
    curl -fsSL https://feynman.is/install | bash -s -- 0.2.31
EOF
  exit 1
fi

checksums_path="$tmp_dir/SHA256SUMS"
step "Verifying ${archive_name}"
download_file "$checksums_url" "$checksums_path"
checksum_matches="$(awk -v name="$archive_name" '$2 == name || $2 == "*" name { print $1 }' "$checksums_path")"
checksum_count="$(printf '%s\n' "$checksum_matches" | awk 'NF { count += 1 } END { print count + 0 }')"
if [ "$checksum_count" -ne 1 ]; then
  if [ "$checksum_count" -eq 0 ]; then
    echo "SHA256SUMS does not contain a valid checksum for ${archive_name}." >&2
  else
    echo "SHA256SUMS contains multiple checksum entries for ${archive_name}." >&2
  fi
  exit 1
fi
expected_checksum="$(printf '%s\n' "$checksum_matches" | sed -n '1p')"
case "$expected_checksum" in
  "" | *[!0-9a-fA-F]*)
    echo "SHA256SUMS does not contain a valid checksum for ${archive_name}." >&2
    exit 1
    ;;
esac
if [ "${#expected_checksum}" -ne 64 ]; then
  echo "SHA256SUMS contains a malformed checksum for ${archive_name}." >&2
  exit 1
fi
actual_checksum="$(sha256_file "$archive_path")"
if [ "$actual_checksum" != "$expected_checksum" ]; then
  echo "SHA-256 mismatch for ${archive_name}: expected ${expected_checksum}, found ${actual_checksum}." >&2
  exit 1
fi

extract_root="$tmp_dir/extract"
mkdir -p "$extract_root"
run_with_spinner "Extracting ${archive_name}" tar -xzf "$archive_path" -C "$extract_root"
candidate_bundle="$extract_root/$bundle_name"
if [ ! -x "$candidate_bundle/feynman" ]; then
  echo "Downloaded archive did not contain the expected executable: ${bundle_name}/feynman" >&2
  exit 1
fi
candidate_version="$("$candidate_bundle/feynman" --version | tail -n 1)"
if [ "$candidate_version" != "$resolved_version" ]; then
  echo "Downloaded bundle version mismatch: expected ${resolved_version}, found ${candidate_version}." >&2
  exit 1
fi
"$candidate_bundle/feynman" --help >/dev/null

mkdir -p "$INSTALL_APP_DIR"
mkdir -p "$INSTALL_BIN_DIR"
bundle_dir="$INSTALL_APP_DIR/$bundle_name"
backup_dir="$tmp_dir/previous-bundle"
had_previous=0
if [ -e "$bundle_dir" ]; then
  mv "$bundle_dir" "$backup_dir"
  had_previous=1
fi
if ! mv "$candidate_bundle" "$bundle_dir"; then
  if [ "$had_previous" -eq 1 ]; then
    mv "$backup_dir" "$bundle_dir"
  fi
  echo "Failed to install the validated Feynman bundle." >&2
  exit 1
fi

step "Linking feynman into $INSTALL_BIN_DIR"
shim_candidate="$tmp_dir/feynman-shim"
if ! cat >"$shim_candidate" <<EOF
#!/bin/sh
set -eu
exec "$INSTALL_APP_DIR/$bundle_name/feynman" "\$@"
EOF
then
  rm -rf "$bundle_dir"
  if [ "$had_previous" -eq 1 ]; then
    mv "$backup_dir" "$bundle_dir"
  fi
  exit 1
fi
chmod 0755 "$shim_candidate"
if ! mv "$shim_candidate" "$INSTALL_BIN_DIR/feynman"; then
  rm -rf "$bundle_dir"
  if [ "$had_previous" -eq 1 ]; then
    mv "$backup_dir" "$bundle_dir"
  fi
  exit 1
fi
rm -rf "$backup_dir"

for old_bundle in "$INSTALL_APP_DIR"/feynman-*; do
  if [ -d "$old_bundle" ] && [ "$old_bundle" != "$bundle_dir" ]; then
    rm -rf "$old_bundle"
  fi
done

add_to_path

case "$path_action" in
  added)
    step "PATH updated for future shells in $path_profile"
    step "Run now: export PATH=\"$INSTALL_BIN_DIR:\$PATH\" && hash -r && feynman"
    ;;
  configured)
    step "PATH is already configured for future shells in $path_profile"
    step "Run now: export PATH=\"$INSTALL_BIN_DIR:\$PATH\" && hash -r && feynman"
    ;;
  skipped)
    step "PATH update skipped"
    step "Run now: export PATH=\"$INSTALL_BIN_DIR:\$PATH\" && hash -r && feynman"
    ;;
  *)
    step "$INSTALL_BIN_DIR is already on PATH"
    step "Run: hash -r && feynman"
    ;;
esac

warn_command_conflict

printf 'Feynman %s installed successfully.\n' "$resolved_version"
