# tools

`VoiceSanityTest.java` checks the two pure string functions in `Voice` — the one
that keeps JSON out of chat, and the one that decides a "thank you" is not an
order for thirty more ingots. Both were real bugs.

It is deliberately not a Gradle test: the mod ships no test dependencies, and
adding a `src/test` source set made Gradle try to resolve a launch injector it
cannot reach offline. These are string functions; a JVM is enough.

    ./gradlew build
    javac -cp build/classes/java/main -d build/testclasses tools/VoiceSanityTest.java
    java -cp "build/classes/java/main;build/testclasses;<minecraft>;<brigadier>" \
        dev.nexuscraft.ember.VoiceSanityTest

The two jars are in the Gradle cache; `gradlew dependencies` will name them.
