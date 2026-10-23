#!/usr/bin/env bash
# Jobbra-tarts deploy — helyi wrapper.
# Frissíti a játékot gitből a htpc gépen, újraépíti a Docker image-et és újraindítja a konténert.
#
# Használat:  ./deploy.sh
#
set -euo pipefail
exec ssh htpc 'bash ~/bin/jobbra-tarts-deploy.sh'
