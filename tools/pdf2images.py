#!/usr/bin/env python3
"""
Turn a picture-book PDF into the WebP files a book folder needs.

    python3 tools/pdf2images.py "input/My Book.pdf" my-book --first 5 --last 19

The cover is the whole of page 1, title text included. Story art is the *embedded*
illustration from each page, so the page's printed text is not baked into the picture
(the app renders the text itself). Use --list first to find the story page range.

Requires: brew install poppler webp   (and Pillow)
"""
import argparse, glob, os, subprocess, sys, tempfile

try:
    from PIL import Image
except ImportError:
    sys.exit("needs Pillow:  python3 -m pip install pillow")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        sys.exit(" ".join(cmd) + "\n" + r.stderr[:500])
    return r.stdout


def save_webp(img, dest, maxedge, q):
    img = img.convert("RGB")
    w, h = img.size
    if max(w, h) > maxedge:
        s = maxedge / max(w, h)
        img = img.resize((round(w * s), round(h * s)), Image.LANCZOS)
    img.save(dest, "WEBP", quality=q, method=6)
    return img.size, os.path.getsize(dest)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("slug", nargs="?", help="book folder name under books/")
    ap.add_argument("--first", type=int, help="PDF page holding story page 1")
    ap.add_argument("--last", type=int, help="PDF page holding the last story page")
    ap.add_argument("--cover-page", type=int, default=1)
    ap.add_argument("--max-art", type=int, default=900)
    ap.add_argument("--max-cover", type=int, default=900)
    ap.add_argument("--quality", type=int, default=78)
    ap.add_argument("--list", action="store_true",
                    help="show each page's text and image count, then exit")
    a = ap.parse_args()

    if a.list:
        pages = int([l for l in run(["pdfinfo", a.pdf]).splitlines()
                     if l.startswith("Pages")][0].split()[-1])
        for i in range(1, pages + 1):
            txt = run(["pdftotext", "-f", str(i), "-l", str(i), a.pdf, "-"])
            rows = run(["pdfimages", "-list", "-f", str(i), "-l", str(i), a.pdf]
                       ).splitlines()[2:]
            # column 3 is the type; smask rows also say "image" in their enc column
            n = sum(1 for l in rows if len(l.split()) > 2 and l.split()[2] == "image")
            first = " / ".join(t.strip() for t in txt.strip().splitlines()[:2])
            print(f"p{i:<3} images={n}  {first[:70]}")
        return

    if not (a.slug and a.first and a.last):
        sys.exit("need slug, --first and --last (run with --list to find them)")

    out = os.path.join(ROOT, "books", a.slug)
    os.makedirs(out, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp:
        run(["pdftoppm", "-f", str(a.cover_page), "-l", str(a.cover_page), "-r", "150",
             "-png", a.pdf, os.path.join(tmp, "cov")])
        cov = sorted(glob.glob(os.path.join(tmp, "cov-*.png")))[0]
        size, nb = save_webp(Image.open(cov), os.path.join(out, "cover.webp"),
                             a.max_cover, a.quality)
        print(f"cover.webp   {size[0]}x{size[1]}  {nb // 1024} KB")

        for n, p in enumerate(range(a.first, a.last + 1), start=1):
            pre = os.path.join(tmp, f"p{p}")
            for old in glob.glob(pre + "-*.png"):
                os.remove(old)
            run(["pdfimages", "-f", str(p), "-l", str(p), "-png", a.pdf, pre])
            parts = sorted(glob.glob(pre + "-*.png"))
            if not parts:
                sys.exit(f"pdf page {p}: no embedded image found")
            img = Image.open(parts[0]).convert("RGB")
            note = ""
            if len(parts) > 1:                                  # soft mask
                mask = Image.open(parts[1]).convert("L")
                if mask.size != img.size:
                    mask = mask.resize(img.size, Image.LANCZOS)
                img = Image.composite(img, Image.new("RGB", img.size, "white"), mask)
                note = "  (mask composited onto white)"
            size, nb = save_webp(img, os.path.join(out, f"{n}.webp"), a.max_art, a.quality)
            print(f"{n}.webp".ljust(13) + f"{size[0]}x{size[1]}  {nb // 1024} KB  <- pdf p{p}{note}")

    total = sum(os.path.getsize(os.path.join(out, f))
                for f in os.listdir(out) if f.endswith(".webp"))
    print(f"\n{a.slug}: {len(glob.glob(os.path.join(out, '*.webp')))} files, {total // 1024} KB")
    print(f"next: write books/{a.slug}/book.json and add \"{a.slug}\" to books.json")


if __name__ == "__main__":
    main()
