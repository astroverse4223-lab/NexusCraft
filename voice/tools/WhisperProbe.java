package dev.nexuscraft.voice;

import ai.onnxruntime.NodeInfo;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;

import java.io.PrintStream;
import java.nio.charset.StandardCharsets;

/**
 * What the two Whisper graphs actually want.
 *
 * Written before any of the real work, for the same reason the Kokoro build
 * started with a vocabulary dump: the difficult part of running somebody else's
 * model is never the arithmetic, it is discovering that the tensor is called
 * `past_key_values.0.decoder.key` and is shaped [1, 6, 0, 64] on the first pass
 * and [1, 6, n, 64] on every pass after.
 *
 * Guessing that from documentation costs an afternoon. Printing it costs a
 * second.
 *
 *   java ... dev.nexuscraft.voice.WhisperProbe &lt;folder with the .onnx files&gt;
 */
public final class WhisperProbe {

    public static void main(String[] args) throws Exception {
        PrintStream out = new PrintStream(System.out, true, StandardCharsets.UTF_8);
        String where = args.length > 0 ? args[0] : ".";

        OrtEnvironment env = OrtEnvironment.getEnvironment();

        for (String name : new String[]{"encoder", "decoder"}) {
            out.println("=== " + name + " ===");

            try (OrtSession session = env.createSession(where + "/" + name + ".onnx",
                    new OrtSession.SessionOptions())) {

                out.println("  inputs:");
                for (var entry : session.getInputInfo().entrySet()) {
                    out.println("    " + describe(entry.getKey(), entry.getValue()));
                }

                out.println("  outputs:");
                int shown = 0;
                for (var entry : session.getOutputInfo().entrySet()) {
                    // The decoder returns dozens of cache tensors; a few is enough
                    // to see the naming scheme, and the rest follow it.
                    if (shown++ > 6) {
                        out.println("    ... and " + (session.getOutputInfo().size() - shown + 1) + " more");
                        break;
                    }
                    out.println("    " + describe(entry.getKey(), entry.getValue()));
                }
            }
            out.println();
        }
    }

    private static String describe(String name, NodeInfo info) {
        return String.format("%-46s %s", name, info.getInfo().toString());
    }
}
