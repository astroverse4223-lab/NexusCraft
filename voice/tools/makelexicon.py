#!/usr/bin/env python3
"""Builds the pronunciation dictionary the mod ships.

Kokoro does not take text. It takes phonemes — a string of IPA symbols drawn
from a fixed 115-symbol vocabulary — and the job of turning "light the tunnel"
into "lˈaɪt ðə tˈʌnəl" is called grapheme-to-phoneme, or G2P. The JavaScript
build gets that from `phonemizer`, a port of espeak-ng's rules. There is no Java
equivalent, so this makes one out of a dictionary instead.

CMUdict has 135,166 English words with stress marked, under a permissive
licence. It is written in ARPAbet, which is a one-to-one relabelling of the same
sounds, so converting it to Kokoro's IPA is a lookup table rather than a
判断 — the hard part of G2P is already done and published.

Done here rather than in Java on purpose: the mapping is a decision, and a
decision that runs at build time can be read, diffed and argued with in one
file, instead of being re-derived on every startup. The mod ships the answer.

    python tools/makelexicon.py

Reads cmudict.dict beside it (or downloads it) and writes
src/main/resources/assets/nexusvoice/voice/lexicon.tsv.gz
"""

import gzip
import io
import os
import sys
import urllib.request

CMUDICT_URL = "https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict"

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "src", "main", "resources", "assets", "nexusvoice", "voice", "lexicon.tsv.gz")

# ARPAbet to the IPA symbols that exist in Kokoro's vocabulary.
#
# Every value here was checked against the 115 symbols the tokenizer accepts.
# Two are easy to get wrong: the "g" is U+0261 LATIN SMALL LETTER SCRIPT G, not
# an ASCII g, which is not in the vocabulary at all; and "r" is ɹ, the English
# approximant, not the trill.
ARPA = {
    "AA": "ɑ", "AE": "æ", "AH": "ʌ", "AO": "ɔ", "AW": "aʊ", "AY": "aɪ",
    "EH": "ɛ", "EY": "eɪ", "IH": "ɪ", "IY": "i", "OW": "oʊ", "OY": "ɔɪ",
    "UH": "ʊ", "UW": "u",
    "B": "b", "CH": "ʧ", "D": "d", "DH": "ð", "F": "f", "G": "ɡ", "HH": "h",
    "JH": "ʤ", "K": "k", "L": "l", "M": "m", "N": "n", "NG": "ŋ", "P": "p",
    "R": "ɹ", "S": "s", "SH": "ʃ", "T": "t", "TH": "θ", "V": "v", "W": "w",
    "Y": "j", "Z": "z", "ZH": "ʒ",
}

VOWELS = {"AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY",
          "IH", "IY", "OW", "OY", "UH", "UW"}

# Words the game uses constantly that no English dictionary has. Written by
# hand because there is no rule that gets them right and getting them wrong is
# the first thing anyone will notice.
MINECRAFT = {
    "netherite": "nˈɛðəɹaɪt",
    "creeper": "kɹˈipɚ",
    "creepers": "kɹˈipɚz",
    "enderman": "ˈɛndɚmæn",
    "endermen": "ˈɛndɚmɛn",
    "nether": "nˈɛðɚ",
    "redstone": "ɹˈɛdstoʊn",
    "obsidian": "əbsˈɪdiən",
    "minecraft": "mˈaɪnkɹæft",
    "mojang": "moʊjˈæŋ",
    "griefer": "ɡɹˈifɚ",
    "spawner": "spˈɔnɚ",
    "hopper": "hˈɑpɚ",
    "piglin": "pˈɪɡlɪn",
    "piglins": "pˈɪɡlɪnz",
    "shulker": "ʃˈʌlkɚ",
    "warden": "wˈɔɹdən",
    "deepslate": "dˈipsleɪt",
    "amethyst": "ˈæməθɪst",
    "elytra": "ˈɛlɪtɹə",
    "ravager": "ɹˈævɪʤɚ",
    "trident": "tɹˈaɪdənt",
    "ember": "ˈɛmbɚ",
    "hollow": "hˈɑloʊ",
}


def convert(phones):
    """One CMUdict pronunciation to a Kokoro phoneme string.

    Stress is the only part that takes thought, and it is worth getting exactly
    right: the mark goes *immediately before the stressed vowel*, after any
    consonants that lead into it. "dark" is dˈɑɹk, not ˈdɑɹk.

    That is not what a phonetics textbook says — textbook IPA puts the mark at
    the front of the whole syllable — but it is what espeak-ng emits, and espeak
    is what generated the phonemes Kokoro was trained on. The model has never
    seen a stress mark in front of an onset consonant. Kokoro's own JavaScript
    build gives it away in a hardcoded fixup, `kˈoʊkəɹoʊ` for its own name, and
    again in `nˈaɪn` for "nine": the k and the n come first, then the mark.

    The first version of this walked the mark back over the onset, textbook
    style. It looked more correct and would have made every word subtly wrong.
    """
    out = []
    marks = []  # (index into out, mark) placed after the fact

    for phone in phones:
        stress = ""
        base = phone
        if phone and phone[-1] in "012":
            base, digit = phone[:-1], phone[-1]
            stress = "ˈ" if digit == "1" else ("ˌ" if digit == "2" else "")

        if base == "ER":
            # Stressed "ER" is a full vowel; unstressed is the reduced one.
            ipa = "ɜɹ" if stress else "ɚ"
        elif base == "AH" and not stress:
            ipa = "ə"
        else:
            ipa = ARPA.get(base)
            if ipa is None:
                return None

        if stress:
            # Right here, in front of the vowel itself. See the note above.
            marks.append((len(out), stress))

        out.append((ipa, base))

    # Inserted back to front so earlier positions stay valid.
    symbols = [ipa for ipa, _ in out]
    for at, mark in sorted(marks, reverse=True):
        symbols.insert(at, mark)

    return "".join(symbols)


def main():
    source = os.path.join(HERE, "cmudict.dict")
    if not os.path.exists(source):
        print("downloading cmudict...")
        urllib.request.urlretrieve(CMUDICT_URL, source)

    words = {}
    skipped = 0

    with open(source, encoding="utf-8") as handle:
        for line in handle:
            line = line.split("#")[0].strip()
            if not line:
                continue

            parts = line.split()
            word, phones = parts[0], parts[1:]

            # "word(2)" is an alternate pronunciation; the first one wins.
            if word.endswith(")"):
                continue
            if word in words:
                continue

            ipa = convert(phones)
            if ipa is None:
                skipped += 1
                continue
            words[word] = ipa

    # Ours override CMUdict where both have an opinion.
    words.update(MINECRAFT)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with gzip.open(OUT, "wt", encoding="utf-8", newline="\n") as handle:
        for word in sorted(words):
            handle.write(word + "\t" + words[word] + "\n")

    size = os.path.getsize(OUT)
    print(f"wrote {len(words)} words to {OUT} ({size // 1024} KB gzipped)")
    if skipped:
        print(f"skipped {skipped} with symbols outside Kokoro's vocabulary")

    # Windows consoles default to cp1252 and cannot print IPA; the file is
    # UTF-8 regardless, so only this preview needs persuading.
    out = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    for check in ["hello", "lantern", "netherite", "creeper", "diamond", "tunnel"]:
        out.write("  %-12s %s\n" % (check, words.get(check, "(missing)")))
    out.flush()


if __name__ == "__main__":
    main()
