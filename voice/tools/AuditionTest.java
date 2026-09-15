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
 * The same line, in every voice worth considering, as files you can play.
 *
 * Written because picking a voice off a description is guesswork and picking it
 * off a quality grade is worse — the grades say which voice is cleanest, not
 * which one sounds like the character. The only way to choose is to hear the
 * same sentence in each, back to back, and the sentence has to be one the
 * character actually says.
 *
 *   java ... dev.nexuscraft.voice.AuditionTest <output dir> [voice ...]
 */
public final class AuditionTest {

    /**
     * His own introduction.
     *
     * Chosen because it has to work twice: it is the first thing he ever says,
     * and it is the line the whole arc later makes sinister. A voice that can
     * only do one of those is the wrong voice.
     */
    private static final String LINE =
            "I'm Hollow. That's not a name so much as a description, but it'll do.";

    private static final String[] SHORTLIST = {
            "am_michael", "am_fenrir", "am_puck", "bm_fable", "bm_george", "am_onyx",
    };

    public static void main(String[] args) throws Exception {
        PrintStream out = new PrintStream(System.out, true, StandardCharsets.UTF_8);

        Path where = Paths.get(args.length > 0 ? args[0] : ".");
        String[] voices = args.length > 1
                ? java.util.Arrays.copyOfRange(args, 1, args.length)
                : SHORTLIST;

        Models.keepIn(where);
        out.println("\"" + LINE + "\"");
        out.println(Phonemes.of(LINE));
        out.println();

        for (String voice : voices) {
            if (!Models.fetch(voice)) {
                out.println("FAIL  " + voice + " — could not be fetched");
                continue;
            }

            long began = System.currentTimeMillis();
            float[] audio = KokoroVoice.speak(LINE, voice, 1.0f);
            if (audio == null || audio.length == 0) {
                out.println("FAIL  " + voice + " — nothing came back");
                continue;
            }

            float peak = 0.0f;
            for (float sample : audio) peak = Math.max(peak, Math.abs(sample));

            File wav = where.resolve(voice + ".wav").toFile();
            write(audio, wav);

            out.printf("ok    %-12s %.1fs  peak %.2f  (%dms)  -> %s%n",
                    voice, audio.length / (double) KokoroVoice.SAMPLE_RATE,
                    peak, System.currentTimeMillis() - began, wav.getName());
        }
    }

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
