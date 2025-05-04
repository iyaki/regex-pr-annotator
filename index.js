const core = require('@actions/core');
const github = require('@actions/github');

async function run() {
  try {
    const token = core.getInput('github-token') || process.env.GITHUB_TOKEN;
    if (!token) {
      core.setFailed('GitHub token is required (input or GITHUB_TOKEN env var)');
      return;
    }
    const debug = core.getInput('debug') === 'true';

    const rulesInput = core.getInput('rules', { required: true });
    let rules;
    try {
      rules = JSON.parse(rulesInput);
      if (!Array.isArray(rules)) throw new Error('`rules` must be a JSON array');
    } catch (err) {
      core.setFailed(`Invalid JSON for rules: ${err.message}`);
      return;
    }
    if (debug) core.info(`Parsed rules: ${JSON.stringify(rules)}`);

    const validLevels = ['notice', 'warning', 'error'];

    const context = github.context;

    if (!context.payload.pull_request) {
      core.setFailed('Action must be run on pull_request events.');
      return;
    }

    const { owner, repo } = context.repo;
    const prNumber = context.payload.pull_request.number;
    const octokit = github.getOctokit(token);

    const { data: files } = await octokit.rest.pulls.listFiles({ owner, repo, pull_number: prNumber });

    for (const file of files) {
      if (!file.patch) continue;
      if (debug) {
        core.info(`Processing file: ${file.filename}\nPatch:\n${file.patch}`);
      }
      const lines = file.patch.split('\n');
      let newLine = 0;
      for (const line of lines) {
        // Match Git unified diff headers to track line numbers. The first part of
        // the regex (`^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@`) matches the entire
        // header, and the \+(\d+) part captures the line number that the current
        // block of lines starts on in the resulting file. The exec() method
        // returns an array where the first element is the full match and the
        // second element is the captured group, which is the line number.
        const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
        if (header) {
          newLine = parseInt(header[1], 10) - 1;

        // Added lines
        } else if (line.startsWith('+') && !line.startsWith('+++')) {
          newLine++;
          const text = line.slice(1);
          for (const rule of rules) {
            if (rule.paths) {
              const patterns = Array.isArray(rule.paths) ? rule.paths : [rule.paths];
              if (!patterns.some(p => new RegExp(p).test(file.filename))) {
                continue;
              }
            }

            const lvl = rule['level'] || 'warning';
            if (!validLevels.includes(lvl)) {
              core.setFailed(`Invalid level '${lvl}'. Must be one of notice, warning, or error.`);
              return;
            }

            const re = new RegExp(rule.regex);
            if (re.test(text)) {
              const msgTemplate = rule.message || 'Line matches regex "{regex}"';
              const matchRes = text.match(re);
              const matchedText = matchRes ? matchRes[0] : '';
              const message = msgTemplate
                .replace('{regex}', rule.regex)
                .replace('{line}', text)
                .replace('{match}', matchedText);

              core[lvl](message, { file: file.filename, startLine: newLine})
              if (debug) {
                core.info(`[debug] Matched rule ${rule.regex} in ${file.filename} at line ${newLine}: ${matchedText}`);
              }
            }
          }

        // Removed lines
        } else if (!line.startsWith('-')) {
          ++newLine;
        }
      }
    }

  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
