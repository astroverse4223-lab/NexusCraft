#!/usr/bin/env python3
"""Turns Whisper's tokenizer into something the mod can read in a millisecond.

tokenizer.json is 2.4MB of nested JSON describing a tokenizer that can both
encode and decode. Only half of that is ever needed here — audio goes in and
text comes out, so the model produces token ids and nothing ever has to turn
text back into them.

So this keeps the half that matters: id, then the token, one per line, gzipped.
The result is about a fifth of the size and needs no JSON parser at runtime,
which matters because the alternative is hand-rolling one for a file with fifty
thousand entries in it.

    python tools/makewhispervocab.py <tokenizer.json>
"""

import gzip
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(
    HERE, "..", "src", "main", "resources", "assets", "nexusvoice",
    "voice", "whisper-vocab.tsv.gz"))


def main():
    source = sys.argv[1] if len(sys.argv) > 1 else "tokenizer.json"
    with open(source, encoding="utf-8") as handle:
        tokenizer = json.load(handle)

    # Ordinary tokens, plus the specials, which live in a separate list and are
    # the ones that end a transcript — leaving them out means never stopping.
    tokens = dict(tokenizer["model"]["vocab"])
    for special in tokenizer.get("added_tokens", []):
        tokens[special["content"]] = special["id"]

    by_id = {}
    for token, index in tokens.items():
        by_id[index] = token

    os.makedirs(os.path.dirname(OUT), exist_ok=True)

    written = 0
    with gzip.open(OUT, "wt", encoding="utf-8", newline="\n") as handle:
        for index in sorted(by_id):
            token = by_id[index]

            # A literal newline or tab in a token would break the format. GPT-2
            # spells them Ċ and Ġ, so this should never fire — it is here so
            # that if it ever does, it corrupts one token rather than the file.
            if "\n" in token or "\t" in token:
                continue

            handle.write("%d\t%s\n" % (index, token))
            written += 1

    print("wrote %d tokens to %s (%d KB gzipped)"
          % (written, OUT, os.path.getsize(OUT) // 1024))


if __name__ == "__main__":
    main()
