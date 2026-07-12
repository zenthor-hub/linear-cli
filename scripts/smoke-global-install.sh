#!/usr/bin/env bash
set -euo pipefail

package_file="$PWD/$(bun pm pack --quiet --ignore-scripts | tail -n 1)"
install_prefix="$(mktemp -d)"

cleanup() {
  rm -rf "$install_prefix" "$package_file"
}
trap cleanup EXIT

BUN_INSTALL="$install_prefix" bun install --global "$package_file" >/dev/null

"$install_prefix/bin/linear" --version
"$install_prefix/bin/linear-admin" --version
"$install_prefix/bin/linear" --help | grep --quiet -- "--profile"
"$install_prefix/bin/linear-admin" --help | grep --quiet -- "--profile"
"$install_prefix/bin/linear" auth profile --help | grep --quiet -- "add-key"
