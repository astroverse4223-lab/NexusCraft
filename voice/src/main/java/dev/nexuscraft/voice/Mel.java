package dev.nexuscraft.voice;

/**
 * Sound as Whisper wants to see it: a log-mel spectrogram.
 *
 * The model does not take audio. It takes an 80 by 3000 picture of audio — how
 * much energy there is in each of eighty frequency bands, in each of three
 * thousand ten-millisecond slices — and everything here exists to produce that
 * picture in exactly the shape it was trained on.
 *
 * "Exactly" is the whole difficulty, and it is why this is written out longhand
 * rather than pulled from a library. Every constant below is Whisper's: 16kHz
 * audio, a 400-sample window, a 160-sample hop, a Hann window, and mel filters
 * built the way librosa builds them with slaney normalisation. Get any of them
 * slightly wrong and nothing fails — the model simply reads out a confident
 * sentence that nobody said, and there is no error anywhere to tell you why.
 */
public final class Mel {

    /** What the model was trained on. Everything else is resampled to it. */
    public static final int SAMPLE_RATE = 16_000;

    /** Whisper's window: 25ms of audio, hopped every 10ms. */
    public static final int WINDOW = 400;
    public static final int HOP = 160;

    /** Frequency bands, and slices. Thirty seconds at ten milliseconds each. */
    public static final int BANDS = 80;
    public static final int FRAMES = 3000;

    /** Real FFT bins for a 400-sample window padded to 512. */
    private static final int FFT = 512;
    private static final int BINS = FFT / 2 + 1;

    private static float[][] filters;
    private static float[] hann;

    private Mel() {
    }

    /**
     * 16kHz mono samples to the 80x3000 the encoder expects.
     *
     * Shorter audio is silence-padded and longer audio is cut, because the
     * model has exactly one input size and thirty seconds is it. A four-second
     * sentence spends the remaining twenty-six on padding, which is wasteful
     * and is what the model expects.
     */
    public static float[] spectrogram(float[] audio) {
        prepare();

        float[] out = new float[BANDS * FRAMES];
        float[] window = new float[FFT];
        float[] real = new float[FFT];
        float[] imaginary = new float[FFT];
        float[] power = new float[BINS];

        float loudest = Float.NEGATIVE_INFINITY;

        for (int frame = 0; frame < FRAMES; frame++) {
            int start = frame * HOP;

            /*
             * Whisper centres each window on its frame, reflecting the signal
             * at the edges rather than padding with zeros. Zero padding puts a
             * sharp edge at the start of every clip, and a sharp edge is
             * broadband noise — the first few frames come out as a hiss the
             * model then tries to transcribe.
             */
            java.util.Arrays.fill(window, 0.0f);
            for (int i = 0; i < WINDOW; i++) {
                int at = start + i - WINDOW / 2;
                if (at < 0) at = -at;
                if (at >= audio.length) at = Math.max(0, 2 * audio.length - at - 2);
                if (at >= 0 && at < audio.length) window[i] = audio[at] * hann[i];
            }

            System.arraycopy(window, 0, real, 0, FFT);
            java.util.Arrays.fill(imaginary, 0.0f);
            fft(real, imaginary);

            for (int bin = 0; bin < BINS; bin++) {
                power[bin] = real[bin] * real[bin] + imaginary[bin] * imaginary[bin];
            }

            for (int band = 0; band < BANDS; band++) {
                float sum = 0.0f;
                float[] filter = filters[band];
                for (int bin = 0; bin < BINS; bin++) {
                    if (filter[bin] != 0.0f) sum += filter[bin] * power[bin];
                }

                float decibels = (float) (Math.log10(Math.max(sum, 1.0e-10)));
                out[band * FRAMES + frame] = decibels;
                loudest = Math.max(loudest, decibels);
            }
        }

        /*
         * Whisper's own normalisation, and it is not optional: clamp to eighty
         * decibels below the peak, then squash to roughly -1..1. Skipping it
         * leaves the numbers an order of magnitude out and the transcript is
         * fluent, plausible, and unrelated to the sound.
         */
        float floor = loudest - 8.0f;
        for (int i = 0; i < out.length; i++) {
            out[i] = (Math.max(out[i], floor) + 4.0f) / 4.0f;
        }

        return out;
    }

    /** Anything to 16kHz, linearly. */
    public static float[] resample(float[] audio, int from) {
        if (from == SAMPLE_RATE) return audio;

        double step = (double) from / SAMPLE_RATE;
        int length = (int) (audio.length / step);
        float[] out = new float[Math.max(1, length)];

        for (int i = 0; i < out.length; i++) {
            double at = i * step;
            int left = (int) at;
            int right = Math.min(audio.length - 1, left + 1);
            float fraction = (float) (at - left);
            out[i] = audio[left] * (1.0f - fraction) + audio[right] * fraction;
        }
        return out;
    }

    /* --------------------------------------------------------- the tables */

    private static synchronized void prepare() {
        if (filters != null) return;

        hann = new float[WINDOW];
        for (int i = 0; i < WINDOW; i++) {
            hann[i] = (float) (0.5 - 0.5 * Math.cos(2.0 * Math.PI * i / WINDOW));
        }

        filters = melFilters();
    }

    /**
     * The mel filterbank, built the way librosa builds it.
     *
     * Eighty triangular filters spaced evenly on the mel scale between 0Hz and
     * 8kHz, each normalised by its own width — that last part is "slaney"
     * normalisation and it is the detail most re-implementations miss, because
     * without it the filters still look right and every band is wrong by a
     * factor that varies with frequency.
     */
    private static float[][] melFilters() {
        double lowest = hzToMel(0.0);
        double highest = hzToMel(SAMPLE_RATE / 2.0);

        // One point either side of each band: 80 filters need 82 edges.
        double[] points = new double[BANDS + 2];
        for (int i = 0; i < points.length; i++) {
            points[i] = melToHz(lowest + (highest - lowest) * i / (points.length - 1));
        }

        double[] binHz = new double[BINS];
        for (int bin = 0; bin < BINS; bin++) {
            binHz[bin] = (double) bin * SAMPLE_RATE / FFT;
        }

        float[][] built = new float[BANDS][BINS];

        for (int band = 0; band < BANDS; band++) {
            double left = points[band];
            double middle = points[band + 1];
            double right = points[band + 2];

            // Slaney: each filter integrates to the same area regardless of width.
            double weight = 2.0 / (right - left);

            for (int bin = 0; bin < BINS; bin++) {
                double hz = binHz[bin];
                double rising = (hz - left) / (middle - left);
                double falling = (right - hz) / (right - middle);
                double value = Math.max(0.0, Math.min(rising, falling));
                built[band][bin] = (float) (value * weight);
            }
        }

        return built;
    }

    /*
     * The mel scale, in the piecewise form librosa uses: linear below 1kHz and
     * logarithmic above it. The single-formula version found in most tutorials
     * is the HTK scale, which is a different curve and produces a different
     * filterbank.
     */
    private static final double MEL_BREAK_HZ = 1000.0;
    private static final double MEL_BREAK = 15.0;
    private static final double MEL_STEP = 200.0 / 3.0;
    private static final double LOG_STEP = Math.log(6.4) / 27.0;

    private static double hzToMel(double hz) {
        if (hz < MEL_BREAK_HZ) return hz / MEL_STEP;
        return MEL_BREAK + Math.log(hz / MEL_BREAK_HZ) / LOG_STEP;
    }

    private static double melToHz(double mel) {
        if (mel < MEL_BREAK) return mel * MEL_STEP;
        return MEL_BREAK_HZ * Math.exp(LOG_STEP * (mel - MEL_BREAK));
    }

    /**
     * An in-place radix-2 FFT.
     *
     * Written out because the alternative is a dependency for one function, and
     * this one runs a few thousand times per sentence rather than in a loop
     * anybody will notice.
     */
    private static void fft(float[] real, float[] imaginary) {
        int n = real.length;

        // Bit-reversal permutation.
        for (int i = 1, j = 0; i < n; i++) {
            int bit = n >> 1;
            for (; (j & bit) != 0; bit >>= 1) j ^= bit;
            j ^= bit;

            if (i < j) {
                float swap = real[i]; real[i] = real[j]; real[j] = swap;
                swap = imaginary[i]; imaginary[i] = imaginary[j]; imaginary[j] = swap;
            }
        }

        for (int length = 2; length <= n; length <<= 1) {
            double angle = -2.0 * Math.PI / length;
            float stepReal = (float) Math.cos(angle);
            float stepImaginary = (float) Math.sin(angle);

            for (int start = 0; start < n; start += length) {
                float turnReal = 1.0f;
                float turnImaginary = 0.0f;

                for (int i = 0; i < length / 2; i++) {
                    int here = start + i;
                    int there = here + length / 2;

                    float productReal = real[there] * turnReal - imaginary[there] * turnImaginary;
                    float productImaginary = real[there] * turnImaginary + imaginary[there] * turnReal;

                    real[there] = real[here] - productReal;
                    imaginary[there] = imaginary[here] - productImaginary;
                    real[here] += productReal;
                    imaginary[here] += productImaginary;

                    float nextReal = turnReal * stepReal - turnImaginary * stepImaginary;
                    turnImaginary = turnReal * stepImaginary + turnImaginary * stepReal;
                    turnReal = nextReal;
                }
            }
        }
    }
}
