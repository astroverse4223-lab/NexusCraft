#!/usr/bin/env bash
# Compiles and runs the plain-JVM tests.
#
# Not a Gradle test source set on purpose, for the same reason as Ember's:
# adding one makes Loom try to resolve a launch injector it cannot reach
# offline, and everything worth testing here is arithmetic. A JVM and the
# Minecraft jar are enough.
#
# The classpath is the fiddly part. Vec3d has a Codec in it, so touching one
# pulls in DataFixerUpper, which pulls in fastutil; MathHelper pulls in joml.
# None of it is used by the test and all of it has to be present, or the class
# will not initialise.

set -eu

HERE="$(cygpath -m "$(cd "$(dirname "$0")/.." && pwd)")"
CACHE="$HOME/.gradle/caches"

JAVA_BIN="${JAVA_BIN:-$HOME/AppData/Roaming/nexuscraft-launcher/data/runtimes/java-runtime-delta/windows-x64/bin}"

#
# Everything handed to javac goes through cygpath first: this runs under Git
# Bash, which reports /c/Users/..., and the JVM is a Windows program that reads
# that as a relative path and silently finds nothing on it. The failure looks
# like the mod's own classes having vanished.
win() {
  cygpath -m "$1"
}

find_jar() {
  local found
  found=$(find "$CACHE/$1" -name "$2" 2>/dev/null | grep -v sources | head -1)
  [ -n "$found" ] && win "$found"
}

MC=$(find_jar "fabric-loom/minecraftMaven" "minecraft-merged-*-v2.jar")
BRIG=$(find_jar "modules-2/files-2.1/com.mojang/brigadier" "brigadier-*.jar")
DFU=$(find_jar "modules-2/files-2.1/com.mojang/datafixerupper" "datafixerupper-*.jar")
FAST=$(find_jar "modules-2/files-2.1/it.unimi.dsi" "fastutil-*.jar")
JOML=$(find_jar "modules-2/files-2.1/org.joml" "joml-*.jar")
ORT=$(find_jar "modules-2/files-2.1/com.microsoft.onnxruntime" "onnxruntime-*.jar")
SLF=$(find_jar "modules-2/files-2.1/org.slf4j" "slf4j-api-*.jar")

for jar in "$MC" "$BRIG" "$DFU" "$FAST" "$JOML" "$ORT" "$SLF"; do
  [ -n "$jar" ] || { echo "missing a jar; run ./gradlew build first"; exit 1; }
done

CP="$HERE/build/classes/java/main;$HERE/build/resources/main;$MC;$BRIG;$DFU;$FAST;$JOML;$ORT;$SLF"

mkdir -p "$HERE/build/testclasses"
"$JAVA_BIN/javac.exe" -nowarn -encoding UTF-8 -cp "$CP" -d "$HERE/build/testclasses" "$HERE"/tools/*Test.java

for test in "$HERE"/tools/*Test.java; do
  name=$(basename "$test" .java)
  echo "--- $name ---"
  "$JAVA_BIN/java.exe" -cp "$CP;$HERE/build/testclasses" "dev.nexuscraft.voice.$name" "$HERE/build/voicetest" 2>&1 | grep -v "^SLF4J"
done
