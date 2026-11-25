#!/usr/bin/env python3
"""Pre-push privacy scrub. Fails if anything personal or off-topic slips in.

Checks every tracked file, every image's metadata, and commit authors.
  python3 scripts/scrub.py            check the working tree
  python3 scripts/scrub.py --commits RANGE   also check authors in a range
"""

import base64
import re
import subprocess
import sys

NOREPLY = "257313539+Derkaramma@users.noreply.github.com"

# Words I don't want anywhere in the repo. Encoded so this file doesn't trip itself.
WORDS = [base64.b64decode(w).decode() for w in ['Y2xhdWRl', 'YW50aHJvcGlj', 'Y28tYXV0aG9yZWQ=', 'Z2VuZXJhdGVkIHdpdGg=', 'Z2VuZXJhdGVkIGJ5', 'YXMgYW4gYWk=', 'b3BlbmFp', 'Y29waWxvdA==', 'bGxt']]

# Image tools are fine to name in the prompt guide, nowhere else.
IMAGE_TOOLS = re.compile(base64.b64decode("Y2hhdGdwdHxnZW1pbml8ZGFsbC0/ZXxtaWRqb3VybmV5").decode(), re.IGNORECASE)

PATTERNS = {
    "private IP": re.compile(r"\b(?:192\.168|10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b"),
    "MAC address": re.compile(r"\b[0-9a-f]{2}(?::[0-9a-f]{2}){5}\b", re.IGNORECASE),
    "home folder": re.compile(base64.b64decode("L1VzZXJzL3wvaG9tZS9bYS16XXwvb3B0L3N0YWNrcw==").decode()),
    "PVS serial": re.compile(r"\bZT\d{10,}\b"),
    "email": re.compile(r"[\w.+-]+@(?:icloud|gmail|me|yahoo|outlook|hotmail)\.com", re.IGNORECASE),
    "photo file name": re.compile(r"\b(?:IMG|DJI|PXL)_\d{3,}"),
}

IMAGE_EXT = (".png", ".jpg", ".jpeg", ".webp", ".gif")
# EXIF, XMP, GPS and content credential markers.
META = re.compile(rb"eXIf|Exif\x00|xmpmeta|GPSInfo|caBX|jumb|c2pa", re.IGNORECASE)

SKIP = ("package-lock.json",)


def files():
    out = subprocess.run(["git", "ls-files", "-z"], capture_output=True, check=True).stdout
    return [f for f in out.decode().split("\0") if f]


def main():
    bad = []
    words = re.compile("|".join(re.escape(w) for w in WORDS), re.IGNORECASE)
    for path in files():
        if path.endswith(SKIP):
            continue
        with open(path, "rb") as fh:
            raw = fh.read()
        if path.lower().endswith(IMAGE_EXT):
            if META.search(raw):
                bad.append(f"{path}: image has metadata, strip it")
            continue
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            continue
        for n, line in enumerate(text.splitlines(), 1):
            if words.search(line):
                bad.append(f"{path}:{n}: banned word")
            if IMAGE_TOOLS.search(line) and not path.startswith("prompts/"):
                bad.append(f"{path}:{n}: image tool named outside prompts/")
            for name, pat in PATTERNS.items():
                if pat.search(line):
                    bad.append(f"{path}:{n}: {name}")

    if "--commits" in sys.argv:
        rng = sys.argv[sys.argv.index("--commits") + 1]
        log = subprocess.run(
            ["git", "log", "--format=%H%x00%ae%x00%ce%x00%B%x01", rng],
            capture_output=True, check=True,
        ).stdout.decode()
        for entry in filter(None, (e.strip() for e in log.split("\x01"))):
            sha, author, committer, body = entry.split("\0", 3)
            if author != NOREPLY or committer != NOREPLY:
                bad.append(f"{sha[:7]}: commit email isn't the noreply address")
            if words.search(body):
                bad.append(f"{sha[:7]}: banned word in commit message")

    for b in bad:
        print(b)
    print(f"{len(bad)} problem(s)" if bad else "clean")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
