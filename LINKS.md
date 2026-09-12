# Links and accounts

Kept in the repo on purpose. The ntfy topic is the only thing here that is
remotely secret, and for a handful of test readers there is nothing to gain by
reading the stats and nothing lost if someone posts junk to them.

Worth revisiting only if real students go on the roster — at that point the
topic exposes their names and reading records to anyone who opens this repo,
and a fresh topic kept out of git would be the cheap fix.

The **ntfy topic is the only real secret in the whole system**: anyone holding
it can read every reader's stats and post junk to it. Everything else — the
student codes, the PIN hashes — is already public in `students.json`, and a
four digit PIN is brute-forced instantly whatever you do with it.

## Topic

    rra-zjou8m56j6rmyn

Make one with:

    python3 -c "import secrets;print('rra-'+secrets.token_urlsafe(12).lower()[:14])"

## Children's links

Hand each child theirs once; the code and topic are remembered afterwards.

| Who | PIN | Link |
|---|---|---|
| Roberta 🦊 | 1234 | `https://jacobamiller.github.io/Robertas-Reading-App/index.html?s=uz57&t=rra-zjou8m56j6rmyn` |
| Jacob 🐢   | 4321 | `https://jacobamiller.github.io/Robertas-Reading-App/index.html?s=ynty&t=rra-zjou8m56j6rmyn` |

## Teacher

    https://jacobamiller.github.io/Robertas-Reading-App/progress.html?t=rra-zjou8m56j6rmyn

Not linked from anywhere, which is the only thing keeping it private.

## Keeping history

    python3 tools/snapshot.py rra-zjou8m56j6rmyn --push
