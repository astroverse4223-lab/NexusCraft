#!/usr/bin/env bash
# Installs the built jar, and refuses while Minecraft is holding it.
#
# Overwriting a mod jar in a running game does not fail loudly. Minecraft loads
# classes lazily, so the game keeps working until it needs a class it has not
# touched yet — and then reads it from a file whose zip offsets have all moved,
# and dies with "ZipException: invalid LOC header". It looks exactly like a bug
# in whatever feature that class belonged to.
#
# The first version of this check wrote a throwaway file into the mods folder,
# which proves the folder is writable and nothing about the jar. Windows allows
# creating a sibling of an open file. Renaming the jar itself does not work
# while it is held, so that is the test.

set -u

JAR="${1:?usage: install.sh <built jar> <instance mods dir>}"
MODS="${2:?usage: install.sh <built jar> <instance mods dir>}"
TARGET="$MODS/ember.jar"

[ -f "$JAR" ] || { echo "no such jar: $JAR"; exit 1; }
[ -d "$MODS" ] || { echo "no such mods folder: $MODS"; exit 1; }

if [ -f "$TARGET" ]; then
  if mv "$TARGET" "$TARGET.unlocked" 2>/dev/null; then
    mv "$TARGET.unlocked" "$TARGET"
  else
    echo "REFUSED: Minecraft is running and holding ember.jar."
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
