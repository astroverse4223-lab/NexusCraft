package dev.nexuscraft.voice;

import javax.sound.sampled.AudioFileFormat;
import javax.sound.sampled.AudioFormat;
import javax.sound.sampled.AudioInputStream;
import javax.sound.sampled.AudioSystem;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.PrintStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * Speaks, outside Minecraft, and writes what it said to a file.
 *
 * The whole local voice — the dictionary, the phonemes, the tokenizer, the
 * style vectors, ONNX Runtime and the model — end to end, with nothing of the
 * game present. If this makes a WAV that sounds like English, everything that
 * remains is plumbing.
 *
 * Writes real files you can play, because there is no assertion that
 * distinguishes speech from a plausible-looking array of floats. The numbers
 * below catch a silent or clipped result; your ears are the actual test.
 *
 *   java -cp ... dev.nexuscraft.ember.voice.local.VoiceTest <output dir> [voice]
 */
public final class VoiceTest {

    private static PrintStream out;

    private static final String[] LINES = {
            "It is dark down here, and I am the light.",
            "I found a cave to the north. Follow me.",
            "Here is your thirty gold. Try not to spend it all on torches.",
    };

    public static void main(String[] args) throws Exception {
        out = new PrintStream(System.out, true, StandardCharsets.UTF_8);

        Path where = Paths.get(args.length > 0 ? args[0] : ".");
        String voice = args.length > 1 ? args[1] : "af_heart";

        Models.keepIn(where);
        out.println("models in " + where.toAbsolutePath());

        long began = System.currentTimeMillis();
        if (!Models.fetch(voice)) {
            out.println("FAIL could not get the model");
            System.exit(1);
        }
        out.println("ok   model and voice present (" + (System.currentTimeMillis() - began) + "ms)");

        if (!KokoroVoice.ready()) {
            out.println("FAIL the session would not open");
            System.exit(1);
        }
        out.println("ok   onnx session open");

        int failures = 0;
        for (int i = 0; i < LINES.length; i++) {
            String line = LINES[i];

            long spoke = System.currentTimeMillis();
            float[] audio = KokoroVoice.speak(line, voice, 1.0f);
            long took = System.currentTimeMillis() - spoke;

            if (audio == null || audio.length == 0) {
                out.println("FAIL nothing came back for \"" + line + "\"");
                failures++;
                continue;
            }

            float peak = 0.0f;
            double energy = 0.0;
            for (float sample : audio) {
                peak = Math.max(peak, Math.abs(sample));
                energy += sample * sample;
            }
            double rms = Math.sqrt(energy / audio.length);
            double seconds = audio.length / (double) KokoroVoice.SAMPLE_RATE;

            File wav = where.resolve("line" + (i + 1) + ".wav").toFile();
            write(audio, wav);

            /*
             * Silence and clipping are the two ways this fails while still
             * returning an array of the right length. A peak near zero means
             * the style vector or the tokens were wrong; a peak pinned at one
             * with high RMS means it is distorted rather than speech.
             */
            boolean sane = peak > 0.05f && peak <= 1.5f && rms > 0.005 && seconds > 0.5;
            if (!sane) failures++;

            out.printf("%-5s %.1fs of audio in %dms  peak %.3f  rms %.4f  -> %s%n",
                    sane ? "ok" : "FAIL", seconds, took, peak, rms, wav.getName());
            out.println("        \"" + line + "\"");
            out.println("        " + Phonemes.of(line));
        }

        out.println();
        out.println(failures == 0
                ? "all checks passed — play the wav files to hear it"
                : failures + " FAILED");
        if (failures > 0) System.exit(1);
    }

    /** 24kHz mono 16-bit, so anything can play it. */
    private static void write(float[] audio, File file) throws Exception {
        ByteBuffer bytes = ByteBuffer.allocate(audio.length * 2).order(ByteOrder.LITTLE_ENDIAN);
        for (float sample : audio) {
            float clamped = Math.max(-1.0f, Math.min(1.0f, sample));
            bytes.putShort((short) Math.round(clamped * 32767.0f));
        }

        AudioFormat format = new AudioFormat(KokoroVoice.SAMPLE_RATE, 16, 1, true, false);
        try (AudioInputStream stream = new AudioInputStream(
                new ByteArrayInputStream(bytes.array()), format, audio.length)) {
            AudioSystem.write(stream, AudioFileFormat.Type.WAVE, file);
        }
    }
}
