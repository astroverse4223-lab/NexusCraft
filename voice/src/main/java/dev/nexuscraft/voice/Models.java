package dev.nexuscraft.voice;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Duration;

/**
 * The model files, fetched once and kept.
 *
 * Not shipped in the jar. The voice weights are 82MB and each voice another
 * half a megabyte, which would triple the mod's download for something a player
 * who never turns speech on will never open. So they are pulled the first time
 * the local voice is actually used, into the config directory beside
 * ember.properties, and every launch after that finds them there.
 *
 * Downloads land on a temporary name and are moved into place only once
 * complete. A half-written 82MB file that looks finished is the worst outcome
 * available here: ONNX would fail to parse it on every start afterwards, and
 * the obvious reading of that is "the model is broken" rather than "the
 * download was interrupted".
 */
public final class Models {

    private static final Logger LOG = LoggerFactory.getLogger("Ember");

    private static final String REPO =
            "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main";

    /**
     * The quantised build, 82MB rather than 310MB.
     *
     * Kokoro at full precision is a 310MB download to sound, in a lantern,
     * across a voice chat, indistinguishable from the quantised one. The
     * quality that survives being a game character's voice is not the quality
     * you pay 228MB for.
     */
    private static final String MODEL_FILE = "model_q8f16.onnx";
    private static final String MODEL_URL = REPO + "/onnx/" + MODEL_FILE;

    /** Below this, whatever arrived is not a model. */
    private static final long MODEL_LEAST_BYTES = 40_000_000L;

    /*
     * Listening. Two graphs rather than one, and both quantised.
     *
     * tiny.en rather than base or small: it is 41MB against 240, it runs in
     * about a second on two CPU threads, and what it is transcribing is one
     * sentence of plain English said deliberately into a microphone by
     * somebody who wants to be understood. The larger models earn their size on
     * accents, background noise and languages, none of which is this.
     */
    private static final String WHISPER_REPO =
            "https://huggingface.co/onnx-community/whisper-tiny.en/resolve/main/onnx";

    private static final String ENCODER_FILE = "encoder_model_quantized.onnx";
    private static final String DECODER_FILE = "decoder_model_merged_quantized.onnx";

    private static final long ENCODER_LEAST_BYTES = 6_000_000L;
    private static final long DECODER_LEAST_BYTES = 20_000_000L;

    /** Every voice file is exactly this: 510 positions of 256 floats. */
    private static final long VOICE_BYTES = 510L * 256L * 4L;

    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(20))
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();

    private static Path home;

    private Models() {
    }

    /** Where the files live. Set once, at mod init, from the config directory. */
    public static synchronized void keepIn(Path directory) {
        home = directory;
    }

    public static synchronized Path directory() {
        return home;
    }

    /** Whether everything needed to speak in this voice is already on disk. */
    public static boolean ready(String voice) {
        return home != null
                && Files.isRegularFile(home.resolve(MODEL_FILE))
                && Files.isRegularFile(voiceFile(voice));
    }

    public static Path modelFile() {
        return home.resolve(MODEL_FILE);
    }

    public static Path voiceFile(String voice) {
        return home.resolve("voices").resolve(voice + ".bin");
    }

    public static Path whisperEncoder() {
        return home.resolve(ENCODER_FILE);
    }

    public static Path whisperDecoder() {
        return home.resolve(DECODER_FILE);
    }

    /** Whether both halves of the listening model are already on disk. */
    public static boolean hearingReady() {
        return home != null
                && Files.isRegularFile(whisperEncoder())
                && Files.isRegularFile(whisperDecoder());
    }

    /**
     * Makes sure the listening model is present, downloading if not.
     *
     * Separate from the speaking one and fetched separately, because plenty of
     * people will want one and not the other — and 41MB is not a thing to pull
     * down on the chance that somebody eventually plugs in a microphone.
     */
    public static synchronized boolean fetchHearing() {
        if (home == null) {
            LOG.error("no directory set for the voice models");
            return false;
        }

        try {
            Files.createDirectories(home);

            Path encoder = whisperEncoder();
            if (!Files.isRegularFile(encoder) || Files.size(encoder) < ENCODER_LEAST_BYTES) {
                LOG.info("downloading the listening model — this happens once");
                if (!download(WHISPER_REPO + "/" + ENCODER_FILE, encoder, ENCODER_LEAST_BYTES)) {
                    return false;
                }
            }

            Path decoder = whisperDecoder();
            if (!Files.isRegularFile(decoder) || Files.size(decoder) < DECODER_LEAST_BYTES) {
                if (!download(WHISPER_REPO + "/" + DECODER_FILE, decoder, DECODER_LEAST_BYTES)) {
                    return false;
                }
            }

            return true;
        } catch (Exception e) {
            LOG.error("could not prepare the listening model: {}", e.toString());
            return false;
        }
    }

    /**
     * Makes sure the model and one voice are present, downloading if not.
     *
     * Blocking, and called from a background thread. Returns false rather than
     * throwing, because every caller's correct response to "no voice" is the
     * same: carry on silently, the line is already in chat.
     */
    public static synchronized boolean fetch(String voice) {
        if (home == null) {
            LOG.error("no directory set for the voice models");
            return false;
        }

        try {
            Files.createDirectories(home.resolve("voices"));

            Path model = modelFile();
            if (!Files.isRegularFile(model) || Files.size(model) < MODEL_LEAST_BYTES) {
                LOG.info("downloading the voice model, {} — this happens once", MODEL_FILE);
                if (!download(MODEL_URL, model, MODEL_LEAST_BYTES)) return false;
            }

            Path chosen = voiceFile(voice);
            if (!Files.isRegularFile(chosen) || Files.size(chosen) != VOICE_BYTES) {
                LOG.info("downloading the voice {}", voice);
                if (!download(REPO + "/voices/" + voice + ".bin", chosen, VOICE_BYTES)) return false;
            }

            return true;
        } catch (Exception e) {
            LOG.error("could not prepare the voice model: {}", e.toString());
            return false;
        }
    }

    /**
     * One file, to a temporary name, then moved into place.
     *
     * The size check is the whole point of the temporary name: a truncated
     * download is discarded here rather than being found and trusted a week
     * later.
     */
    private static boolean download(String url, Path to, long leastBytes) {
        Path partial = to.resolveSibling(to.getFileName() + ".partial");

        try {
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .timeout(Duration.ofMinutes(30))
                    .GET()
                    .build();

            HttpResponse<InputStream> response =
                    HTTP.send(request, HttpResponse.BodyHandlers.ofInputStream());

            if (response.statusCode() != 200) {
                LOG.error("{} answered {}", url, response.statusCode());
                return false;
            }

            long began = System.currentTimeMillis();
            long written;

            try (InputStream in = response.body();
                 OutputStream out = Files.newOutputStream(partial)) {
                written = in.transferTo(out);
            }

            if (written < leastBytes) {
                LOG.error("{} stopped after {} bytes, expected at least {}", url, written, leastBytes);
                Files.deleteIfExists(partial);
                return false;
            }

            Files.move(partial, to, StandardCopyOption.REPLACE_EXISTING);
            LOG.info("got {} ({} MB in {}s)", to.getFileName(), written / 1_048_576,
                    (System.currentTimeMillis() - began) / 1000);
            return true;

        } catch (Exception e) {
            LOG.error("could not download {}: {}", url, e.toString());
            try {
                Files.deleteIfExists(partial);
            } catch (Exception ignored) {
                // Nothing useful to do; the size check catches it next time.
            }
            return false;
        }
    }
}
