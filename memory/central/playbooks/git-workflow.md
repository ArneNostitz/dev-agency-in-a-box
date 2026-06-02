# Playbook: Git workflow

The standard branch-to-PR flow every dev agent follows.

1. Make sure you're on an up-to-date `main`: `git fetch origin && git checkout main && git pull`.
2. Create the work branch: `git checkout -b agency/issue-<NUMBER>`.
3. Implement the change for the issue. Keep the diff minimal and focused.
4. Stage and commit: `git add -A && git commit -m "<imperative summary> (#<NUMBER>)"`.
5. Push the branch: `git push -u origin agency/issue-<NUMBER>`.
6. Open a draft PR linking the issue:
   `gh pr create --draft --fill --base main --head agency/issue-<NUMBER> --body "Closes #<NUMBER>\n\n<what changed, how to test>"`.
7. Comment the result on the issue with the PR URL and the local test command.

Never commit to `main`. Never force-push. Never merge your own PR.
