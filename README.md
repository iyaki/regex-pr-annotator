# Regex PR Annotator

Annotate pull requests based on configurable regex rules applied to added lines.

## Inputs

- `github-token` (optional): A GitHub token for API calls. Defaults to the `GITHUB_TOKEN` environment variable.

- `rules` (required): A JSON array of rule objects. Each rule supports:
  - `regex`: string, the regular expression to test added lines.
  - `message`: annotation message supporting placeholders:
    - `{regex}`: the rule's regex.
    - `{line}`: the full text of the added line.
    - `{match}`: the matched substring.
  - `level`: annotation level (`notice`, `warning`, or `error`). Default: `warning`.
  - `paths`: optional string or array of strings (regex patterns) to filter target files.

## Example Workflow

```yaml
name: PR Regex Annotation

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  annotate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Annotate PR with Regex
        uses: iyaki/pr-annotate-regex@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          rules: |
            [
              {
                "regex": "TODO",
                "level": "warning",
                "message": "Found TODO: {line}",
                "paths": ["\\.js$"]
              },
              {
                "regex": "console\\.log",
                "level": "notice",
                "message": "Avoid console.log: found '{match}'"
              }
            ]
```

## No Outputs

This action does not produce outputs.

## Building

```shell
npm ci
npm run build
```
