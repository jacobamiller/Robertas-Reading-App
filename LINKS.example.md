# Links and accounts — EXAMPLE

Copy this to `LINKS.md`, which is gitignored, and put the real values there.

The **ntfy topic is the only real secret in the whole system**: anyone holding
it can read every reader's stats and post junk to it. Everything else — the
student codes, the PIN hashes — is already public in `students.json`, and a
four digit PIN is brute-forced instantly whatever you do with it.

## Topic

    rra-xxxxxxxxxxxxxx

Make one with:

    python3 -c "import secrets;print('rra-'+secrets.token_urlsafe(12).lower()[:14])"

## Children's links

Hand each child theirs once; the code and topic are remembered afterwards.

| Who | PIN | Link |
|---|---|---|
| Roberta 🦊 | 1234 | `https://…/index.html?s=uz57&t=<topic>` |
| Jacob 🐢   | 4321 | `https://…/index.html?s=ynty&t=<topic>` |

## Teacher

    https://…/progress.html?t=<topic>

Not linked from anywhere, which is the only thing keeping it private.

## Keeping history

    python3 tools/snapshot.py <topic> --push
