# Playbook: Git workflow

The standard branch-to-PR flow every dev agent follows.

1. Make sure you're on an up-to-date `main`: `git fetch origin && git checkout main && git pull`.
2. Create the work branch: `git checkout -b agency/issue-<NUMBER>`.
3. Implement the change for the issue. Keep the diff minimal and focused.
4. **Stage only intended source changes — never generated/auto-created files.** Do NOT blindly
   `git add -A` if it would sweep in build output or dependencies. Before committing, run
   `git status` and review. Generated artifacts must NOT be committed, e.g.:
   `node_modules/`, `dist/`, `build/`, `.next/`, `out/`, `coverage/`, `*.log`, `.DS_Store`,
   `.env`, caches, compiled output, generated lockfile churn you didn't intend.
   If such files show up as untracked, **add them to the repo's `.gitignore`** (create/extend it)
   instead of committing them. If they're already tracked from a previous mistake, remove them
   with `git rm -r --cached <path>` and add to `.gitignore` in the same commit.
   Then: `git add <the source files you changed> && git commit -m "<imperative summary> (#<NUMBER>)"`.
5. Push the branch: `git push -u origin agency/issue-<NUMBER>`.
6. Open a draft PR linking the issue:
   `gh pr create --draft --fill --base main --head agency/issue-<NUMBER> --body "Closes #<NUMBER>\n\n<what changed, how to test>"`.
7. Comment the result on the issue with the PR URL and the local test command.

## Commit early, commit often (so work is never lost)

The container can be restarted at any time (deploys, etc.). Anything not committed-and-pushed
is lost on restart, and the run resumes from your last push. So:

- **Commit and push after each logical chunk**, not just once at the very end — after a file or
  small group of files works, `git add <those files> && git commit -m "…" && git push`. A run
  that does everything and commits only at the end loses ALL of it if interrupted at that step.
- Push as soon as the branch has its first commit (create the draft PR early, even before tests
  pass — it's a draft). Then keep pushing.
- Keep commit messages short and single-line (avoid long heredoc commits that can be cut off
  mid-write).
- If you're **resuming** (the branch already exists), `git fetch` + check it out, see what's
  already committed, and finish only what's missing — never redo committed work.

Never commit to `main`. Never force-push. Never merge your own PR.
**A PR should contain only source changes — no build artifacts or dependencies, ever.**
