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

Never commit to `main`. Never force-push. Never merge your own PR.
**A PR should contain only source changes — no build artifacts or dependencies, ever.**
