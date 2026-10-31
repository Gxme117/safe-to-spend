#!/usr/bin/env python3
"""Records Tim's or Frank's openings in his voice, with ElevenLabs, so the app can play them (no key or server in the app).

Each opening in src/lib/<who>Hellos.json is one script, written to be heard: what he says, with how he says it in [audio
tags] ("[sighs]", "[softly]") and the cadence in its punctuation (ellipses for a pause, a full stop for a beat). It's
recorded in one take on Eleven v4 (which does tags, and does Jerry B., a professional clone, justice), with the
"with-timestamps" call, so we know when each letter is said. Everything on screen follows the recording: the captions are
cut from where he pauses and ends his sentences, each word shows as he says it (src/lib/timSpeech.ts), and his mouth comes
from how loud he is every 1/12s (on twos), shut in pauses and sighs, narrower on an o or u.

One take each, to save credits. To refine one, change its script (the tags, the punctuation) and run this again: it records
only the openings whose script has changed since their recording, into assets/<who>-voice/h<i>.mp3, and writes
src/lib/<who>Voice.json and assets/<who>-voice/index.ts. --only 3 records that one again even if its script hasn't changed
(another take of the same words). A script changed but not recorded again shows at his own pace, silent (a test says so).
  Run from mobile/:  python3 scripts/voice.py  [--who tim]  [--only 3]

The key is never in the repo: it's ELEVENLABS_API_KEY in the shell, or else the one the ElevenLabs CLI saved in the repo
root's .env.local (git ignores it; `npx @elevenlabs/cli@latest onboard init` puts it there). Needs macOS (afconvert).
"""
import argparse
import base64
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import wave
from array import array
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

API = "https://api.elevenlabs.io/v1/text-to-speech/{voice}/with-timestamps?output_format=mp3_44100_128"
# each one's voice, from the ElevenLabs voice library (the accountant function's lib.ts says the same, for his answers),
# and the name the app knows his recordings by
WHO = {
    "frank": {"voice": "QzTKubutNn9TjrB7Xb2Q", "clips": "FRANK_CLIPS", "name": "Frank"},  # Jerry B. (New York Italian mobster)
    "tim": {"voice": "qxePw1S1QmBgjlU3GIy5", "clips": "TIM_CLIPS", "name": "Tim"},
}
MODEL = "eleven_v4"  # tags and professional clones both; v3 didn't sound like him, multilingual v2 ignores tags
SETTINGS = {"speed": 1.0}  # the same for every take, so all of them sound like one man on one day
TICK = 1000 / 12  # ms: his mouth changes on twos (ON_TWOS in src/lib/timEyes.ts)
ROUND = set("ouw")  # said with rounded lips: his narrower mouth (3)


def key(i):
    return f"h{i}"  # voiceKey in src/lib/timSpeech.ts


def key_from_file():
    """The key the ElevenLabs CLI saved in the repo root's .env.local (git ignores it), if it's there."""
    env = ROOT.parent / ".env.local"
    if not env.exists():
        return ""
    for line in env.read_text().splitlines():
        name, _, value = line.partition("=")
        if name.strip().removeprefix("export ") == "ELEVENLABS_API_KEY":
            return value.strip().strip("\"'")
    return ""


def untagged(text):
    """A script without its [audio tags], as the app shows it (untagged in src/lib/timSpeech.ts; the words are the same)."""
    return re.sub(r"\s*\[[^\]]*\]\s*", " ", text).strip()


def spoken(alignment):
    """Each letter he says, with when (ms), leaving out [audio tags], which come back with times of their own (the sigh)."""
    out, tag = [], False
    for c, s, e in zip(alignment["characters"], alignment["character_start_times_seconds"], alignment["character_end_times_seconds"]):
        if c == "[":
            tag = True
        if tag:
            tag = c != "]"
            continue
        out.append((c, round(s * 1000), round(e * 1000)))
    return out


def words_of(letters):
    """Each word's start and end (ms): from its first character to its last letter (a full stop gets the silence after it)."""
    words, inside = [], False
    for c, s, e in letters:
        if c.isspace():
            inside = False
        elif not inside:
            inside = True
            words.append({"start": s, "end": e})
        elif c.isalnum():
            words[-1]["end"] = e
    return words


def loudness(mp3):
    """How loud the take is every TICK (RMS, 0..1 of its own loudest), decoded with macOS's afconvert. And its length (ms)."""
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "take.wav"
        subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16@22050", "-c", "1", str(mp3), str(wav)], check=True)
        with wave.open(str(wav)) as w:
            rate, n = w.getframerate(), w.getnframes()
            samples = array("h", w.readframes(n))
    per = rate * TICK / 1000
    levels = []
    for t in range(math.ceil(n / per)):
        chunk = samples[round(t * per):round((t + 1) * per)]
        levels.append(math.sqrt(sum(x * x for x in chunk) / len(chunk)) if chunk else 0)
    loud = sorted(levels)[int(len(levels) * 0.95)] or 1  # his loud, not one spike
    return [min(1, x / loud) for x in levels], round(n * 1000 / rate)


def mouth_of(levels, letters, words):
    """His mouth each TICK: 0 shut (quiet), 1 slightly open, 2 open, 3 narrower when it's open on an o, u or w. Between words
    (a sigh, clearing his throat) it opens a little at most, so it doesn't look like talking; a lone tick open between shut
    ones is only a little open."""
    said = [(c.lower(), s) for c, s, _ in letters if c.isalpha()]
    out, j = [], 0
    for t, level in enumerate(levels):
        mid = (t + 0.5) * TICK
        while j + 1 < len(said) and said[j + 1][1] <= mid:
            j += 1
        pose = 0 if level < 0.12 else 1 if level < 0.35 else 2
        if not any(w["start"] - TICK / 2 <= mid <= w["end"] + TICK / 2 for w in words):
            pose = min(pose, 1)
        elif pose == 2 and said and said[j][0] in ROUND:
            pose = 3
        out.append(pose)
    for t in range(1, len(out) - 1):
        if out[t] > 1 and out[t - 1] == 0 and out[t + 1] == 0:
            out[t] = 1
    return "".join(map(str, out))


def record(text, voice, model, api_key):
    body = {"text": text, "model_id": model, "voice_settings": SETTINGS}
    req = urllib.request.Request(API.format(voice=voice), data=json.dumps(body).encode(), method="POST",
                                 headers={"xi-api-key": api_key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            return json.load(res)
    except urllib.error.HTTPError as e:
        sys.exit(f"ElevenLabs said no to {text!r}: {e.code} {e.read().decode(errors='replace')[:300]}")


def take(out, i, script, voice, model, api_key):
    """Records opening i into the app: the recording, and when each word is said and his mouth for it."""
    got = record(script, voice, model, api_key)
    out.mkdir(parents=True, exist_ok=True)
    mp3 = out / f"{key(i)}.mp3"
    mp3.write_bytes(base64.b64decode(got["audio_base64"]))
    letters = spoken(got["alignment"])
    words = words_of(letters)
    if len(words) != len(untagged(script).split()):
        sys.exit(f"{script!r}: the recording's words don't line up with the script's ({len(words)} for {len(untagged(script).split())})")
    levels, ms = loudness(mp3)
    print(f"{mp3.name}  {ms / 1000:4.1f}s  {untagged(script)}")
    return {"text": script, "ms": max(ms, words[-1]["end"]), "words": words, "mouth": mouth_of(levels, letters, words)}


def write_index(out, who, times):
    lines = [f"// Made by scripts/voice.py: {WHO[who]['name']}'s openings in his voice, one take each. Don't edit.",
             f"export const {WHO[who]['clips']}: Record<string, number> = {{"]
    lines += [f'  "{k}": require("./{k}.mp3"),' for k in sorted(times)]
    lines.append("};")
    (out / "index.ts").write_text("\n".join(lines) + "\n")


def main():
    ap = argparse.ArgumentParser(description="Record Tim's or Frank's openings in his ElevenLabs voice: the ones whose script has changed.")
    ap.add_argument("--who", choices=sorted(WHO), default="frank")
    ap.add_argument("--only", type=int, help="record just this opening again, even if its script hasn't changed (0 is the first)")
    ap.add_argument("--voice", help="another voice to try (his own, otherwise)")
    ap.add_argument("--model", default=MODEL)
    args = ap.parse_args()
    hellos = ROOT / "src" / "lib" / f"{args.who}Hellos.json"
    times_file = ROOT / "src" / "lib" / f"{args.who}Voice.json"
    out = ROOT / "assets" / f"{args.who}-voice"
    voice = args.voice or WHO[args.who]["voice"]
    scripts = [h["script"] for h in json.loads(hellos.read_text())]
    if args.only is not None and not 0 <= args.only < len(scripts):
        sys.exit(f"--only goes from 0 to {len(scripts) - 1}")
    times = json.loads(times_file.read_text()) if times_file.exists() else {}
    # what to record: the one asked for, or every opening whose recording isn't of its script as it is now
    todo = [args.only] if args.only is not None else [i for i, s in enumerate(scripts) if times.get(key(i), {}).get("text") != s]
    if todo:
        api_key = os.environ.get("ELEVENLABS_API_KEY", "").strip() or key_from_file()
        if not api_key:
            sys.exit("No ElevenLabs key: run `npx @elevenlabs/cli@latest onboard init` from the repo root, or set ELEVENLABS_API_KEY.")
    for i in todo:
        times[key(i)] = take(out, i, scripts[i], voice, args.model, api_key)
    # recordings of openings no longer said go
    times = {k: v for k, v in times.items() if any(k == key(i) and v["text"] == s for i, s in enumerate(scripts))}
    out.mkdir(parents=True, exist_ok=True)
    for f in out.glob("*.mp3"):
        if f.stem not in times:
            f.unlink()
    times_file.write_text(json.dumps(dict(sorted(times.items())), indent=1) + "\n")
    write_index(out, args.who, times)
    spent = sum(len(scripts[i]) for i in todo)
    print(f"Recorded {len(todo)} ({spent} characters). {WHO[args.who]['name']} has {len(times)} of {len(scripts)} openings in his voice." if todo
          else "Every opening's recording is of its script as it is now: nothing to record.")


if __name__ == "__main__":
    main()
