#!/usr/bin/env bash
# Installs a built mod jar, and refuses while Minecraft is holding it.
#
# One script for every mod in this repo. Each of them used to carry its own
# near-identical copy, which meant the lock check — the part that matters — had
# to be got right more than once.
#
# Overwriting a mod jar in a running game does not fail loudly. Minecraft loads
# classes lazily, so the game keeps working until it needs a class it has not
# touched yet, then reads it from a file whose zip offsets have all moved and
# dies with "ZipException: invalid LOC header". It looks exactly like a bug in
# whatever feature that class belonged to, which is how it cost a full round of
# debugging the wrong thing twice.
#
# The first version of this check wrote a throwaway file into the mods folder,
# which proves the folder is writable and nothing about the jar — Windows allows
# creating a sibling of an open file. Renaming the jar itself does not work
# while it is held, so that is the test.
#
#   bash tools/install-mod.sh <built jar> <instance mods dir> [installed name]

set -u

JAR="${1:?usage: install-mod.sh <built jar> <instance mods dir> [installed name]}"
MODS="${2:?usage: install-mod.sh <built jar> <instance mods dir> [installed name]}"
NAME="${3:-}"

[ -f "$JAR" ] || { echo "no such jar: $JAR"; exit 1; }
[ -d "$MODS" ] || { echo "no such mods folder: $MODS"; exit 1; }

# Default to the jar's own name with any version stripped, so
# "ember-0.2.0.jar" installs as "ember.jar" and replaces the old one rather
# than sitting beside it — two versions of one mod is a loader error.
if [ -z "$NAME" ]; then
  NAME="$(basename "$JAR" .jar | sed 's/-[0-9].*$//').jar"
fi

TARGET="$MODS/$NAME"

if [ -f "$TARGET" ]; then
  if mv "$TARGET" "$TARGET.unlocked" 2>/dev/null; then
    mv "$TARGET.unlocked" "$TARGET"
  else
    echo "REFUSED: Minecraft is running and holding $NAME."
    echo "         Close the game fully — leaving the world is not enough —"
    echo "         then run this again."
    exit 2
  fi
fi

cp "$JAR" "$TARGET" || exit 1

if command -v md5sum >/dev/null 2>&1; then
  a=$(md5sum "$JAR" | awk '{print $1}')
  b=$(md5sum "$TARGET" | awk '{print $1}')
  [ "$a" = "$b" ] || { echo "copy did not verify"; exit 1; }
fi

echo "installed $(basename "$JAR") -> $TARGET"
