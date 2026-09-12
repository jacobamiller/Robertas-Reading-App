# TODO

## 1. Import a privately-owned book from the device

**Goal:** read a book we own a copy of, on the kids' phones, without the file ever
going into this public repo or onto any host.

**Blocked on:** picking the book. Want to do this with a larger book than the four
currently in `books/`, so the choice drives the page count and the typing effort.

### Decision, so it doesn't get re-argued

Book is imported from a zip on the device and stored in **IndexedDB**. The published
site never carries it and no server ever sees it.

Options considered and dropped:

| Option | Why not |
|---|---|
| Local folder + `python3 -m http.server` over LAN | LAN `http://` is not a secure context, so `navigator.mediaDevices` is undefined (reader.html:601) — no mic, no scoring, no recording |
| Tunnel (`cloudflared`) | Gives real HTTPS and works today, but the URL is genuinely public while it runs. Fine for testing with the four public books, not for this |
| Cloudflare Pages + Access | Works, no code, but the file does sit on Cloudflare and is fetched over the wire. Also a login on a kid's tablet |
| Encrypted blob in the public repo | Still publishing it; the key ships in the JS next to it |

### Why a single zip, built stored

- One file to pick — iOS Files multi-select is fiddly and version-dependent
- Can't arrive half-copied and break on page 13
- `book.json` references its images by name, so they have to travel together
- Built with `zip -0` (stored, not deflated), the reader slices bytes out of it —
  the mirror of the existing `makeZip` writer, no library. WebP is already
  compressed so deflate buys nothing (same reasoning as the recording zip)
- Doubles as the master backup / second-device copy

Exclude dotfiles when zipping — this project has stray `.DS_Store` files.

### Work

The engine is well factored for this: every image path funnels through `imgSrc()`
(reader.html:295), with one bypass at the cover (reader.html:718), and book loading
is a single `fetch()` (reader.html:691).

- [ ] `--zip` flag on `tools/pdf2images.py` — `zipfile` + `ZIP_STORED`, ~15 lines
- [ ] `--text` flag on `tools/pdf2images.py` — `pdftotext` per page into a draft
      `book.json`: strip trailing page numbers, straighten smart quotes, split on
      `.!?` into `pages[].s`. Leaves splits to review rather than text to type
- [ ] IndexedDB helper (open/get/put/delete), ~50 lines
- [ ] `loadBook()` branch: local book instead of fetch, ~25 lines
- [ ] `imgSrc()` → blob-URL map, plus the cover at line 718, ~30 lines
- [ ] Import UI on `index.html`: pick, validate, store, list, delete, ~150 lines
- [ ] `manifest.json` + icons (see storage note below)
- [ ] Test on a real iPhone and a real Android

Roughly one day, 6–8 hours. Most of it is the import UI and phone testing.

Suggested order: `--zip` first, then get an existing public book loading from
IndexedDB end-to-end, before building any import UI.

### Storage: import once, not every launch

- **Android Chrome** — persists indefinitely. Call `navigator.storage.persist()`
  on import. Lost only on explicit clear-data or uninstall.
- **iPhone Safari** — wiped after **7 days of not visiting the site**. The fix is
  adding it to the Home Screen, which iOS exempts from that rule — hence the
  `manifest.json` item above. Regular use also resets the clock.
- Either way, detect a missing book and offer a one-tap re-pick, so the worst case
  is ~20 seconds and not a re-setup.

### Larger book — things to re-check

- Current books are 0.5–1.2 MB for 9–15 pages. IndexedDB has room to spare, but
  confirm the actual size once the book is chosen.
- **Check the PDF has a text layer first** — `pdftotext -f 5 -l 5 book.pdf -`
  should print the story text. All four current books do, so extraction is scripted,
  not typed. A scanned/image-only PDF would need OCR and is the one thing that
  would make a book genuinely expensive. Test this *before* committing to a book.
- Given a text layer, the remaining manual work is reviewing the sentence splits,
  not transcribing. Budget an hour or so, not a day.
- Teacher recordings are per-page in `localStorage` (~5 MB cap), so page count
  doesn't change that. Page *length* could.

## 2. Teacher recordings don't feed back into the reader

Noted while looking around, not yet discussed. The recording page captures clips and
zips them out to be shared, and plays them back within that page (reader.html:826),
but the reader's own read-aloud is `speechSynthesis` only. Nothing imports a
teacher's recordings back in as the read-along voice, which seems like the point of
recording them.

## 3. Pre-rendered TTS voice (decided: Aiden + instruct)

Replace per-device `speechSynthesis` with audio rendered ahead of time on the Mac,
so the voice is identical on every phone. Fixes the "voice quality varies a lot by
device" caveat in the README.

**Voice decided:** Qwen3-TTS `speaker: "Aiden"` on `/api/v1/custom-voice/generate`,
with `instruct` set to:

    bright, playful children's storyteller, animated delivery,
    neutral American accent, warm and encouraging

Aiden is a preset speaker, so he is stable across sentences with nothing to preserve —
the voice is reproducible from those two strings alone.

Voice-design (a designed female storyteller, cloned via `create-prompt` + a frozen
`prompt_id`) was tried and **rejected — sounded bad**. Don't revisit: it also had a
reproducibility trap, since voice-design is stochastic and the voice exists only as
long as its reference clip survives.

### Verified against the running app

- Pinokio app **Qwen3-TTS MLX WebUI Enhanced**, local REST API, `speaker: "Aiden"`
- `instruct` works (same text: 9.12s plain vs 7.84s instructed, bytes differ)
- **`speed` is a no-op** — 0.25 / 1.0 / 2.0 all return ~4.1–4.6s. Do not try to render
  per-speed variants; use `audio.playbackRate` in the browser instead
- ~2 sec of generation per sentence after warm-up (~45 sec for a 21-sentence book)
- WAV 24kHz → AAC mono 48kbps via built-in `afconvert`, ~5.5 KB per second of audio
- Requires Pinokio running locally; this is a build-time step, not runtime

### Work

- [ ] `tools/tts.py` — walk `book.json`, POST each sentence, `afconvert` to
      `books/<slug>/audio/p{page}_s{n}.m4a`, ~60 lines
- [ ] Reader: in `speak()`, play the clip when the book has audio, else fall back to
      `speechSynthesis` unchanged
- [ ] Drive word highlighting from the **existing** estimator (reader.html:396-408),
      scaled to real `audio.duration`. That fallback already exists for browsers with
      no boundary events, and gets more accurate here since the duration is known.
      Note: the README's "never read audio.duration" warning is scoped to
      MediaRecorder blobs — a rendered m4a reports duration correctly
- [ ] Four speed chips (`.4`/`.7`/`1`/`1.35`, reader.html:247-250) via
      `audio.playbackRate`; `preservesPitch` keeps the voice from chipmunking.
      If `.4` sounds smeared, raise that chip to `0.5` — no re-render needed

Shares the playback path with item 2, so building this closes that too.
Adds roughly 350-800 KB per book.

## 4. Read the whole book without stopping at each page

Today "Read to me" stops dead at the end of every page — `readPage`'s terminator
calls `stopAll()`, and pages only move via the prev/next buttons. Nothing
auto-advances. For a child listening, that means an adult has to tap on every
page turn.

**Small change.** `drawPage()` redraws image, text and highlights but never
touches `speaking`, so continuing is just declining to stop: when we are still
speaking, the page is finished, and a next page exists — bump `page`, call
`drawPage()`, scroll to top, re-enter `readPage(0)` after a pause. Stop keeps
working throughout, since it only sets `speaking=false`.

### Decisions already made

- **"Read to me" only.** Echo and "Score my reading" wait for the child, and
  practice mode shows a per-page score at the end of each page that
  auto-advancing would skip. Both keep stopping.
- **Default on, with a settings toggle** ("Read the whole book" / "Stop at each
  page"), remembered like the speed chip.
- **700-900 ms between pages**, longer than the 320 ms between sentences, so the
  new picture registers before the next sentence starts.

### Work

- [ ] The terminator change in `readPage`, ~10 lines
- [ ] Settings toggle + persistence, ~15 lines
- [ ] Preload the next page's first clip. `drawPage()` already prefetches the
      next page image (reader.html:364) but not its audio, so a continuous read
      may gap at each page turn on a phone

Roughly 30-40 lines, under an hour with testing on both phones.

## 5. Dark and light mode

Most of the groundwork exists already: `reader.html` has a `:root` token block
and **80 of its colour uses already go through `var(--...)`**, so a dark mode is
largely a matter of redefining eight values.

    :root{ --paper:#FFFDF7; --ink:#1E1B18; --faded:#A9A29A;
           --crayon-blue:#2C6FB5; --crayon-green:#4E9A3E;
           --crayon-red:#D93A2B; --sun:#FFD23F; --line:#E4DED2; }

### Decide this before picking any colours

**The page art cannot go dark.** The WebPs are children's book illustrations on
white paper, so a dark page gives you a brilliant white rectangle that no token
can fix. Keep the image on a light card with a soft border even in dark mode, so
it reads as a page *on* a dark desk rather than a glare.

Also note the desktop view already sits in a dark slate phone frame (`#243138`),
so dark mode makes the whole desktop surface continuous rather than a light phone
on a dark desk.

### What still needs tokenising

About 15 unique raw hexes outside `:root`, in seven groups. None are in inline
`style=` attributes (zero of those), so it is all one `<style>` block per file.

- white surfaces `#fff` (7 uses), neutral fill `#F0EAE0`, muted text `#8d8780`
- green `#3d7a30`; red states `#a52a1e` `#FCEDEB` `#FBD8D3`; blue `#1f5288`
- desktop phone-frame chrome `#243138` `#0E1214` `#3A474E` `#8FA0A9` — decide
  whether this tracks the theme or stays fixed
- `index.html` is the same job at a quarter the size: 19 var uses, 13 hexes

### Work

- [ ] Tokenise the remaining colours in both files, ~1 hr
- [ ] Dark palette + `@media (prefers-color-scheme: dark)`, ~30 min
- [ ] Manual toggle in the settings sheet, remembered like the speed chip, ~20 min
- [ ] Test and tune on both phones, ~45 min

Half a day, but the split matters: the mechanical part is ~90 min, the rest is
choosing a palette that looks good, which takes eyes and a couple of rounds.
