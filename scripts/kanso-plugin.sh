#!/bin/sh
# Builds `kanso-plugin` from the Kanso commit in kanso-commit.txt and prints
# its path. The tool, its checks and the keys it trusts are exactly that
# commit's, so a change to the rules arrives here only by a commit that
# moves the pin.
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
sha=$(tr -d '[:space:]' < "$here/kanso-commit.txt")
case "$sha" in
    *[!0-9a-f]* | "") echo "kanso-commit.txt must hold a full commit SHA" >&2; exit 1 ;;
esac
[ ${#sha} -eq 40 ] || { echo "kanso-commit.txt must hold a full commit SHA" >&2; exit 1; }
if [ ! -d "$here/kanso/.git" ]; then
    git init -q "$here/kanso"
    git -C "$here/kanso" remote add origin https://github.com/iamngoni/kanso.git
fi
git -C "$here/kanso" fetch -q --depth=1 origin "$sha"
git -C "$here/kanso" checkout -q --detach FETCH_HEAD
# Inside the checkout so its rust-toolchain.toml picks the compiler.
(cd "$here/kanso" && cargo build -q --locked --release -p kanso-plugins --bin kanso-plugin) >&2
echo "$here/kanso/target/release/kanso-plugin"
