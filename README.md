# Roberta's Reading App

A read-along reader for young readers. Read-to-me with word-by-word highlighting,
an echo mode, and a scored practice mode using speech recognition.

**Live:** https://jacobamiller.github.io/Robertas-Reading-App/

## Books

| Book | Pages | Source and licence |
|---|---|---|
| Linda's Surprise | 11 | © 2026 Martha Matzke, illustrated by Grade 1 students, Solomon Islands · [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) |
| Big Blue Bus | 15 | Mecelin Kakoro, illustrated by Mango Tree · © 2015 African Storybook Initiative · [CC BY-SA 4.0](http://creativecommons.org/licenses/by-sa/4.0/) |
| Chameleon Races Rabbit | 11 | Lomwe folktale, Mozambique · images Gavin Thomson © 2016 Little Zebra Books · text © 2016 SIM · [CC BY-SA 4.0](http://creativecommons.org/licenses/by-sa/4.0/) |
| Rabbit Makes Friends With Fire | 9 | Basilio Gimo, Nyungwe tale, Mozambique · images Carol Liddiment © 2014 Little Zebra Books · text © 2015 SIL Moçambique · [CC BY-SA 4.0](http://creativecommons.org/licenses/by-sa/4.0/) |

Three of the four are **CC BY-SA 4.0**, which is a *share-alike* licence: you may use and
adapt them commercially, but anything you distribute that builds on them must carry the
same licence, and the original credits must stay intact. Each book's credits are shown on
its cover screen, drawn from `credit.html` in its `book.json` — don't remove them.

## Layout

```
index.html              the library — lists every book in books.json
reader.html             the reader engine (one file, no dependencies)
books.json              which books to show, and in what order
books/<slug>/
  book.json             title, credits, pages, glossary, quiz
  cover.webp
  1.webp … N.webp       one image per page
progress.html           the teacher's view — everyone, and this device
reading-log.js          records what happens, to IndexedDB
progress-page.js        the teacher view's code
who.js                  the "Who is reading?" screen
students.json           the roster
legacy/reader-v1.5.html the original all-in-one version, kept for reference
```

The engine is book-agnostic. `reader.html?book=<slug>` loads `books/<slug>/book.json`
and renders whatever it finds there.

## Adding a book

1. **Make the folder** — `books/my-book/`, using a slug of letters, digits and hyphens.
2. **Add the images** — use the helper, which does all of the below for you:

   ```sh
   python3 tools/pdf2images.py "input/My Book.pdf" --list        # find the story pages
   python3 tools/pdf2images.py "input/My Book.pdf" my-book --first 5 --last 19
   ```

   By hand it is `cover.webp` plus one image per page.
   From a PDF, the cover is the whole of page 1 but the story art is the *embedded*
   illustration, so the page text is not baked into the picture:

   ```sh
   pdftoppm  -f 1 -l 1 -r 150 -png book.pdf cover   # cover: whole page
   pdfimages -f 5 -l 5 -png book.pdf p5             # story: illustration only
   ```

   Then resize to 900px on the long edge and save as WebP at quality 78 — that is
   plenty for a phone and keeps pages near 70 KB. If `pdfimages` emits a second file,
   it is a soft mask; composite it onto white or transparent areas may go black.
   Needs `brew install poppler webp`.
3. **Write `book.json`** — see the shape below.
4. **List it** — add the slug to `books.json`.
5. **Test locally** — `python3 -m http.server 8000`, then open `localhost:8000`.
   Opening the files directly (`file://`) will *not* work; the browser blocks
   `fetch` on local files.
6. **Publish** — `git add -A && git commit -m "Add my-book" && git push`.
   GitHub Pages rebuilds in about a minute.

### book.json

```json
{
  "slug": "my-book",
  "title": "My Book",
  "subtitle": "Reading Practice",
  "tagline": "Read along, listen, and practise out loud.",
  "credit": { "html": "© 2026 Author Name · <a href=\"…\">CC BY 4.0</a>" },
  "voiceSample": "A short line, spoken when trying out a voice.",
  "cover": "cover.webp",
  "images": { "cover": "cover.webp", "1": "1.webp", "2": "2.webp" },
  "pages": [
    { "img": "1", "s": ["One sentence per entry.", "They highlight one at a time."] },
    { "img": "2", "s": ["Page two."] }
  ],
  "words": [
    { "w": "kitten", "en": "a baby cat", "zh": "小猫" }
  ],
  "quiz": [
    { "q": "How many kittens?", "o": ["Three", "Five", "Six"], "a": 1 }
  ]
}
```

Notes:

- `pages[].img` is a key into `images`, not a filename.
- `pages[].s` is the unit of read-aloud. **Split on sentences** — each entry is
  highlighted, spoken, and scored as one chunk, so this controls the reading rhythm.
- `quiz[].a` is the **zero-based index** of the correct option in `o`.
- `words` and `quiz` are optional. Leave either empty and its tab hides itself.
- `credit.html` and `quiz[].q` are inserted as HTML, so simple tags like `<b>` work.

## Teacher recording page

Open a book, tap the gear, then **Record this page**. The page is scoped to whichever
story page is open: one row per sentence, each with a record button and a play button.
Tap record to start, tap the same button again to stop, and it moves to the next
sentence on its own. Any sentence can be re-recorded by tapping its button again.
A counter reads "3 of 5 recorded".

**Send these recordings** packs everything into **one** zip named
`{slug}_page{n}.zip` — a clip per sentence called `p{page}_s{n}.m4a` (or `.webm`) plus a
`timings.json` — and hands that single file to `navigator.share({files})` so iOS opens
the share sheet. If the browser cannot share files it downloads the same one zip and
says on screen why.

Notes for whoever maintains this:

- **The zip is written by hand** (`makeZip`) because the page carries no libraries.
  Entries are *stored*, not deflated: Opus and AAC are already compressed so deflate
  would buy nothing, and storing keeps the whole build synchronous — which is what lets
  `navigator.share()` stay inside the tap. Bytes come from the base64 already held for
  localStorage, decoded with `atob`, so there is no `await` before sharing. Verified
  against `unzip -t`, Python `zipfile.testzip()` and macOS `ditto`.
- If zipping ever fails, it falls back to sharing the clips individually, and past that
  to downloading them.
- **Container** is feature-detected: `audio/mp4` on Safari, `audio/webm` elsewhere,
  via `MediaRecorder.isTypeSupported`. The extension follows (`.m4a` / `.webm`).
- **Clip length** is wall-clock, measured with `Date.now()` across start and stop.
  Do not switch this to `audio.duration` — for MediaRecorder blobs it commonly reports
  `Infinity` or `NaN` because the container has no duration in its header.
- **Clips live in memory and in `localStorage`**, base64'd, under `rec:<slug>:<pageIndex>`,
  so a reload does not lose them. localStorage caps out around 5 MB; when a write fails
  the page says so and asks the teacher to send now. Sharing is the intended way out,
  not storage.
- `navigator.share` is called **inside the tap** with no `await` before it, or iOS
  rejects it as not user-initiated.
- Requires https or localhost for the microphone. The live Pages site qualifies.
  iOS Safari has had MediaRecorder since 14.3 and file sharing since 15.

## Who is reading, and how it is going

`students.json` is the roster. Add a child and they get a short code:

```sh
python3 tools/students.py add Roberta 1234 --avatar 🦊
python3 tools/students.py list
```

Hand each child a link carrying their code and the reporting topic:

```
index.html?s=uz57&t=<your-topic>
```

They tap their name and four numbers. The PIN stops a sibling poking at
someone else's reading and nothing more — it is checked on the device and the
roster is public, so treat it as a speed bump. Past a handful of children this
wants real accounts and a database.

### What gets recorded

Sentences read with their mode and speed, pages seen, books opened, words
tapped in the story, glossary lookups, quiz answers, and per-page reading
accuracy. All of it goes to IndexedDB on the device, so the app works offline
and nothing is lost waiting to be sent.

The two most telling numbers are not the obvious ones: **tapped words** are the
words a child did not know at a glance, and **re-reads** are the clearest sign
they liked a book.

### Collecting it in one place

Summaries go to [ntfy.sh](https://ntfy.sh), which needs no account and no key
and opens in China. Pick a long random topic, once:

```sh
python3 -c "import secrets;print('rra-'+secrets.token_urlsafe(12).lower()[:14])"
```

That topic is the only secret there is — anyone who knows it can read the
messages and post to it — so it travels in the links you hand out rather than
living in this repo. The first visit stores it on the device.

Each send carries the child's **running totals**, not just what is new, because
ntfy drops messages after about half a day. The newest message per child is
always the whole picture. Sends happen every five minutes, when the app is
closed, and on demand.

Open `progress.html?t=<your-topic>` to see everyone, with CSV and JSON download.
It is not linked from anywhere, which is the only thing making it private.
Or read the raw messages at `https://ntfy.sh/<your-topic>`.

## Notes on behaviour

- **Do not give a top-level `const` the name of a built-in global** — `top`,
  `self`, `name`, `status` and friends. In a classic script that is a
  SyntaxError and the *whole file* silently fails to evaluate. It will not show
  up in `node --check`, nor in `new Function(src)`, nor in `eval(src)`, because
  all three give lexical declarations a scope of their own. Only a real
  `<script>` tag does. `python3 tools/checkjs.py` checks for it.

- **Read-aloud** uses the device's built-in speech synthesis. Voice quality varies a
  lot by device; the Settings sheet lets you pick, and the choice is remembered.
- **Scoring** uses the Web Speech API, which in practice means Chrome and an
  internet connection. Other browsers show the story fine but cannot score.
- **The microphone** needs https or localhost. The live Pages site qualifies.
- Page images for the next page are prefetched, so paging forward is instant.
