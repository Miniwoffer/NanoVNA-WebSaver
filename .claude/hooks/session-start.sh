#!/bin/bash
#
# NanoVNA-WebSaver session start.
#
# There is nothing to install: the application ships as plain ES modules
# with no dependencies and no build step, and the test suite runs on node
# alone. So this checks the toolchain is there and reports whether the
# tree is green, which is the thing worth knowing before touching it.

set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" || exit 0

if ! command -v node > /dev/null 2>&1; then
  echo "node is not on PATH; 'make web-test' will not run."
  exit 0
fi

echo "node $(node --version), no dependencies to install."

if output=$(make web-test 2>&1); then
  echo "Tests: $(echo "$output" | tail -1)"
else
  echo "Tests are FAILING on a clean checkout:"
  echo "$output" | tail -20
fi

# a browser is available for checking interface work; see CLAUDE.md
if [ -x /opt/pw-browsers/chromium-1194/chrome-linux/chrome ]; then
  echo "Chromium is available at /opt/pw-browsers/ for browser checks."
fi

exit 0
