# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues in **ArneNostitz/dev-agency** (the
`origin` remote). Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --repo ArneNostitz/dev-agency --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --repo ArneNostitz/dev-agency --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --repo ArneNostitz/dev-agency --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --repo ArneNostitz/dev-agency --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --repo ArneNostitz/dev-agency --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --repo ArneNostitz/dev-agency --comment "..."`

Note: this repo also has a `fork` remote (`ArneNostitz/dev-agency-in-a-box`). Issues
always belong to **`origin` = `ArneNostitz/dev-agency`**, so always pass `--repo` explicitly.

## When a skill says "publish to the issue tracker"

Create a GitHub issue in `ArneNostitz/dev-agency`.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --repo ArneNostitz/dev-agency --comments`.
