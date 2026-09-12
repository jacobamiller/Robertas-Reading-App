#!/usr/bin/env python3
"""
Render a book's sentences to audio with Qwen3-TTS, so every phone reads in the
same voice instead of whatever the device's speech engine happens to offer.

    python3 tools/tts.py chameleon-races-rabbit

Writes books/<slug>/audio/p{page}_s{n}.m4a — the same naming the teacher
recording page already uses — plus audio/index.json holding each clip's real
duration, which is what drives word highlighting in the reader.

Also renders audio/words/<word>.m4a for the glossary entries and the two quiz
replies, so the Words and Quiz tabs are the same narrator as the story rather
than the device voice. Pass --story-words to additionally cover every word in
the book, which is what tapping a word in the story plays; that is best-effort,
because the model refuses some very short words ("a", "the") and returns
clipped audio for others. Anything it will not render cleanly is left out, and
the reader falls back to the device voice for just those.

Needs the Pinokio app "Qwen3-TTS MLX WebUI Enhanced" running. This is a
build-time step: the phones only ever see the finished .m4a files.

Two things keep the reading steady, because the model on its own will not:

  * Every sentence is generated conditioned on tools/voice/aiden-storyteller.wav,
    not straight from the speaker name. Rendering a book without that reference
    gave a 2.28x pace spread between its fastest and slowest sentence; with it,
    1.54x. The reference is committed, so the voice is reproducible anywhere.
  * Each clip gets a playbackRate `adjust` in index.json that pulls it toward
    TARGET_WPM. The reader multiplies its speed chip by this, so "Normal" means
    the same pace on every sentence. Clamped, so a stray clip is nudged rather
    than stretched into artefacts.

Note: the API's `speed` parameter does nothing (0.25, 1.0 and 2.0 all come back
the same length), and the `instruct` wording barely moves pace either (182-196
wpm across very different phrasings). Playback rate is the only real control.
"""
import argparse, base64, json, os, re, struct, subprocess, sys, time, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = "http://127.0.0.1:42003"
VOICE = os.path.join(ROOT, "tools", "voice", "aiden-storyteller")
TARGET_WPM = 145.0          # a comfortable read-aloud pace for a young reader
REPLIES = {"_yes": "Yes! Well done.", "_no": "Not this time."}
ADJUST_RANGE = (0.80, 1.20)  # beyond this, time-stretching starts to sound off


def load_voice():
    """Freeze the committed reference into a prompt, so every sentence in every
    book is conditioned on the same voice."""
    meta = json.load(open(VOICE + ".json"))
    wav = open(VOICE + ".wav", "rb").read()
    p = post("/api/v1/base/create-prompt",
             {"ref_audio_base64": base64.b64encode(wav).decode(),
              "ref_text": meta["ref_text"], "name": meta["name"]})
    pid = p.get("prompt_id")
    if not pid:
        sys.exit("create-prompt returned no prompt_id: " + str(p)[:300])
    return meta, pid


def post(path, payload, timeout=300):
    req = urllib.request.Request(API + path, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        return json.load(urllib.request.urlopen(req, timeout=timeout))
    except urllib.error.HTTPError as e:
        raise SystemExit(f"generation failed ({e.code}): {e.read().decode()[:200]}")
    except urllib.error.URLError as e:
        sys.exit(f"cannot reach {API} — is the Qwen3-TTS app running in Pinokio?\n  {e}")


def wav_seconds(raw):
    # 24 kHz, 16-bit mono; header is 44 bytes
    return (len(raw) - 44) / 2 / 24000


def to_m4a(wav_path, dest):
    r = subprocess.run(["afconvert", "-f", "m4af", "-d", "aac@24000",
                        "-b", "48000", "-c", "1", wav_path, dest],
                       capture_output=True, text=True)
    if r.returncode:
        sys.exit("afconvert failed:\n" + r.stderr[:500])
    return os.path.getsize(dest)


def word_key(w):
    """Story words arrive with their punctuation attached, so both the renderer
    and the reader reduce them the same way before looking a clip up."""
    return re.sub(r"[^a-z]", "", w.lower())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("slug", help="book folder name under books/")
    ap.add_argument("--only-page", type=int, help="render just this page (1-based)")
    ap.add_argument("--target-wpm", type=float, default=TARGET_WPM)
    ap.add_argument("--story-words", action="store_true",
                    help="also render every word in the story, for word-tap playback")
    ap.add_argument("--force", action="store_true", help="re-render clips that exist")
    a = ap.parse_args()

    bdir = os.path.join(ROOT, "books", a.slug)
    bjson = os.path.join(bdir, "book.json")
    if not os.path.exists(bjson):
        sys.exit(f"no such book: books/{a.slug}/book.json")
    book = json.load(open(bjson))
    out = os.path.join(bdir, "audio")
    os.makedirs(out, exist_ok=True)

    meta, pid = load_voice()
    print(f"{a.slug}: {meta['name']} ({meta['speaker']}), target {a.target_wpm:.0f} wpm\n")
    index, total_bytes, total_secs, made = {}, 0, 0.0, 0
    tmp = os.path.join(out, "_tmp.wav")

    for pi, page in enumerate(book["pages"], 1):
        if a.only_page and pi != a.only_page:
            continue
        for si, sent in enumerate(page["s"], 1):
            name = f"p{pi}_s{si}.m4a"
            dest = os.path.join(out, name)
            if os.path.exists(dest) and not a.force:
                print(f"  {name:<12} exists, skipping")
                continue
            t0 = time.time()
            d = post("/api/v1/base/generate-with-prompt",
                     {"prompt_id": pid, "text": sent, "language": "English"})
            if "audio" not in d:
                sys.exit(f"unexpected response for {name}: {str(d)[:300]}")
            raw = base64.b64decode(d["audio"])
            open(tmp, "wb").write(raw)
            nb = to_m4a(tmp, dest)
            secs = wav_seconds(raw)
            wpm = len(sent.split()) / secs * 60 if secs else a.target_wpm
            # playbackRate multiplier: a clip that runs fast needs to play slow
            adj = min(max(a.target_wpm / wpm, ADJUST_RANGE[0]), ADJUST_RANGE[1])
            index[name] = {"sec": round(secs, 3), "wpm": round(wpm, 1),
                           "adjust": round(adj, 3)}
            total_bytes += nb; total_secs += secs; made += 1
            print(f"  {name:<12} {secs:5.2f}s  {nb // 1024:3d} KB  {wpm:5.1f} wpm  "
                  f"x{adj:.2f}  | {sent[:38]}")

    # glossary words and quiz replies; optionally the whole story vocabulary
    words, wdir = {}, os.path.join(out, "words")
    if not a.only_page:
        os.makedirs(wdir, exist_ok=True)
        seen = {}
        for g in book.get("words", []):
            seen.setdefault(word_key(g["w"]), g["w"])
        seen.update(REPLIES)
        if a.story_words:
            for pg in book["pages"]:
                for sent in pg["s"]:
                    for tok in re.findall(r"[A-Za-z']+", sent):
                        seen.setdefault(word_key(tok), tok.strip("'"))
        seen.pop("", None)
        print(f"\n  {len(seen)} words and replies")
        skipped = []
        for key, spoken in sorted(seen.items()):
            dest = os.path.join(wdir, key + ".m4a")
            if os.path.exists(dest) and not a.force:
                words.setdefault(key, {"sec": 0})
                continue
            raw = None
            # the model rejects some bare short words and clips others; a
            # trailing full stop settles most of them, so try that too
            for attempt in (spoken, spoken + ".", spoken + "."):
                try:
                    d = post("/api/v1/base/generate-with-prompt",
                             {"prompt_id": pid, "text": attempt, "language": "English"})
                except SystemExit:
                    continue
                cand = base64.b64decode(d["audio"]) if "audio" in d else None
                if cand is not None and wav_seconds(cand) >= 0.25:
                    raw = cand
                    break
            if raw is None:
                skipped.append(key)
                continue
            open(tmp, "wb").write(raw)
            nb = to_m4a(tmp, dest)
            words[key] = {"sec": round(wav_seconds(raw), 3)}
            total_bytes += nb; made += 1
        print(f"  {len(words)} available" +
              (f", {len(skipped)} skipped (device voice): {', '.join(skipped[:12])}"
               if skipped else ""))

    if os.path.exists(tmp):
        os.remove(tmp)

    # merge into any existing index so --only-page does not wipe the rest
    ipath = os.path.join(out, "index.json")
    prev = json.load(open(ipath)) if os.path.exists(ipath) else {}
    prev.setdefault("clips", {})
    prev["clips"].update(index)
    prev.setdefault("words", {})
    prev["words"].update(words)
    prev.update({"v": 2, "ext": "m4a", "voice": meta["name"],
                 "speaker": meta["speaker"], "target_wpm": a.target_wpm})
    json.dump(prev, open(ipath, "w"), indent=1)

    if index:
        w = [c["wpm"] for c in index.values()]
        e = [c["wpm"] * c["adjust"] for c in index.values()]
        print(f"\n  raw pace     {min(w):5.0f} - {max(w):5.0f} wpm  "
              f"({max(w)/min(w):.2f}x spread)")
        print(f"  after adjust {min(e):5.0f} - {max(e):5.0f} wpm  "
              f"({max(e)/min(e):.2f}x spread)")
    print(f"\n{made} clips, {total_secs:.1f} sec, {total_bytes // 1024} KB"
          f"  ->  books/{a.slug}/audio/")
    if made:
        print('next: add  "audio": true  to books/%s/book.json' % a.slug)


if __name__ == "__main__":
    main()
