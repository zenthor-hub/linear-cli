#!/usr/bin/env bash
set -euo pipefail

package_file="$(npm pack --silent --ignore-scripts)"
install_prefix="$(mktemp -d)"

cleanup() {
  rm -rf "$install_prefix" "$package_file"
}
trap cleanup EXIT

npm install --global --prefix "$install_prefix" "$package_file" >/dev/null

"$install_prefix/bin/linear" --version
"$install_prefix/bin/linear-admin" --version
"$install_prefix/bin/linear" --help | grep --quiet -- "--profile"
"$install_prefix/bin/linear-admin" --help | grep --quiet -- "--profile"
"$install_prefix/bin/linear" auth profile --help | grep --quiet -- "add-key"
