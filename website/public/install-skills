#!/bin/sh

set -eu

VERSION="latest"
SCOPE="${FEYNMAN_SKILLS_SCOPE:-codex}"
TARGET_DIR="${FEYNMAN_SKILLS_DIR:-}"

step() {
  printf '==> %s\n' "$1"
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

  echo "curl or wget is required to install Feynman skills." >&2
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

  echo "curl or wget is required to install Feynman skills." >&2
  exit 1
}

resolve_version() {
  normalized_version="$(normalize_version "$VERSION")"

  if [ "$normalized_version" = "latest" ]; then
    release_page="$(download_text "https://github.com/advaitpaliwal/feynman/releases/latest")"
    resolved_version="$(printf '%s\n' "$release_page" | sed -n 's@.*releases/tag/v\([0-9][^"<>[:space:]]*\).*@\1@p' | head -n 1)"

    if [ -z "$resolved_version" ]; then
      echo "Failed to resolve the latest Feynman release version." >&2
      exit 1
    fi

    printf '%s\nv%s\n' "$resolved_version" "$resolved_version"
    return
  fi

  printf '%s\nv%s\n' "$normalized_version" "$normalized_version"
}

resolve_target_dir() {
  if [ -n "$TARGET_DIR" ]; then
    printf '%s\n' "$TARGET_DIR"
    return
  fi

  case "$SCOPE" in
    repo)
      printf '%s/.agents/skills/feynman\n' "$PWD"
      ;;
    opencode)
      printf '%s/.opencode/skills/feynman\n' "$PWD"
      ;;
    codex | user)
      codex_home="${CODEX_HOME:-$HOME/.codex}"
      printf '%s/skills/feynman\n' "$codex_home"
      ;;
    *)
      echo "Unknown scope: $SCOPE (expected --codex, --user, --repo, or --opencode)" >&2
      exit 1
      ;;
  esac
}

while [ $# -gt 0 ]; do
  case "$1" in
    --repo)
      SCOPE="repo"
      ;;
    --opencode)
      SCOPE="opencode"
      ;;
    --codex)
      SCOPE="codex"
      ;;
    --user)
      SCOPE="codex"
      ;;
    --dir)
      if [ $# -lt 2 ]; then
        echo "Usage: install-skills.sh [stable|latest|<version>] [--codex|--user|--repo|--opencode] [--dir <path>]" >&2
        exit 1
      fi
      TARGET_DIR="$2"
      shift
      ;;
    edge|stable|latest|v*|[0-9]*)
      VERSION="$1"
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: install-skills.sh [stable|latest|<version>] [--codex|--user|--repo|--opencode] [--dir <path>]" >&2
      exit 1
      ;;
  esac
  shift
done

archive_metadata="$(resolve_version)"
resolved_version="$(printf '%s\n' "$archive_metadata" | sed -n '1p')"
git_ref="$(printf '%s\n' "$archive_metadata" | sed -n '2p')"

archive_url="${FEYNMAN_INSTALL_SKILLS_ARCHIVE_URL:-}"
if [ -z "$archive_url" ]; then
  case "$git_ref" in
    main)
      archive_url="https://github.com/advaitpaliwal/feynman/archive/refs/heads/main.tar.gz"
      ;;
    v*)
      archive_url="https://github.com/advaitpaliwal/feynman/archive/refs/tags/${git_ref}.tar.gz"
      ;;
  esac
fi

if [ -z "$archive_url" ]; then
  echo "Could not resolve a download URL for ref: $git_ref" >&2
  exit 1
fi

install_dir="$(resolve_target_dir)"

step "Installing Feynman skills ${resolved_version} (${SCOPE})"

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT INT TERM

archive_path="$tmp_dir/feynman-skills.tar.gz"
step "Downloading skills archive"
download_file "$archive_url" "$archive_path"

extract_dir="$tmp_dir/extract"
mkdir -p "$extract_dir"
step "Extracting skills"
tar -xzf "$archive_path" -C "$extract_dir"

source_root="$(find "$extract_dir" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
if [ -z "$source_root" ] || [ ! -d "$source_root/skills" ] || [ ! -d "$source_root/prompts" ]; then
  echo "Could not find the bundled skills resources in the downloaded archive." >&2
  exit 1
fi

mkdir -p "$(dirname "$install_dir")"
rm -rf "$install_dir"
mkdir -p "$install_dir"
cp -R "$source_root/skills/." "$install_dir/"
mkdir -p "$install_dir/prompts"
cp -R "$source_root/prompts/." "$install_dir/prompts/"
cp "$source_root/AGENTS.md" "$install_dir/AGENTS.md"
cp "$source_root/CONTRIBUTING.md" "$install_dir/CONTRIBUTING.md"

step "Installed skills to $install_dir"
case "$SCOPE" in
  repo)
    step "Repo-local skills will be discovered automatically from .agents/skills"
    ;;
  opencode)
    step "OpenCode project skills will be discovered from .opencode/skills"
    ;;
  codex | user)
    step "Codex user skills will be discovered from \$CODEX_HOME/skills"
    ;;
esac

printf 'Feynman skills %s installed successfully.\n' "$resolved_version"
