#!/usr/bin/env bash
# Deliberately fail closed: the dataset's images/GIFs are Gym visual media and no direct 2J
# permission is recorded. See docs/legal/exercise-media-inventory.csv before adding any media.
set -eu
echo "Exercise media was not fetched: 2J rights are unverified. Review docs/legal/exercise-media-inventory.csv."
exit 1
