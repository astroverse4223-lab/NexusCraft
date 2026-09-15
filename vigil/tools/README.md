# tools

`LookingTest.java` checks the two decisions the mod is built on: the view cone
in `Observation`, and which pose is allowed at which distance in `Pose`.

Both are deliberately written in plain numbers rather than in Minecraft's types,
so the whole thing runs on a bare JVM. That was not the first attempt — the cone
originally took `Vec3d` and wrapped angles with `MathHelper`, and running one
assertion about a dot product meant putting DataFixerUpper, fastutil, joml and
Guava on the classpath, none of which had anything to do with the question. Nine
doubles needs nothing.

    ./gradlew build
    bash tools/run-tests.sh

`run-tests.sh` finds the jars in the Gradle cache itself and converts every path
through `cygpath`, because this runs under Git Bash and the JVM is a Windows
program: handed `/c/Users/...` it reads a relative path, finds nothing, and
reports the mod's own classes as missing.

`paint.py` generates the entity texture. It needs Pillow.

`install.sh` copies a built jar into an instance and **refuses while Minecraft
is running**, because overwriting a mod jar in a live game does not fail loudly
— the game keeps working until it needs a class it has not loaded yet, then dies
with `ZipException: invalid LOC header`, looking exactly like a bug in whatever
feature that class belonged to.

    bash tools/install.sh build/libs/vigil-0.1.0.jar "<instance>/minecraft/mods"
