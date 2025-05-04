const core = require('@actions/core');
const github = require('@actions/github');

async function run() {
  try {
    const token = core.getInput('github-token', { required: true });
    const regexInput = core.getInput('regex', { required: true });
    const level = core.getInput('annotation-level') || 'warning';
    const regex = new RegExp(regexInput);
    const context = github.context;

    if (!context.payload.pull_request) {
      core.setFailed('Action must be run on pull_request events.');
      return;
    }

    const { owner, repo } = context.repo;
    const prNumber = context.payload.pull_request.number;
    const headSha = context.payload.pull_request.head.sha;
    const octokit = github.getOctokit(token);

    const { data: files } = await octokit.rest.pulls.listFiles({ owner, repo, pull_number: prNumber });
    let annotations = [];

    for (const file of files) {
      if (!file.patch) continue;
      const lines = file.patch.split('\n');
      let newLine = 0;
      for (const line of lines) {
        const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
        if (header) {
          newLine = parseInt(header[1], 10) - 1;
        } else if (line.startsWith('+') && !line.startsWith('+++')) {
          newLine++;
          const text = line.slice(1);
          if (regex.test(text)) {
            annotations.push({
              path: file.filename,
              start_line: newLine,
              end_line: newLine,
              annotation_level: level,
              message: `Line matches regex "${regexInput}"`
            });
          }
        } else if (!line.startsWith('-')) {
          newLine++;
        }
      }
    }

    if (annotations.length === 0) {
      console.log('No regex matches found.');
      return;
    }
    if (annotations.length > 50) {
      core.warning(`More than 50 annotations found: only reporting first 50 out of ${annotations.length}`);
      annotations = annotations.slice(0, 50);
    }

    await octokit.rest.checks.create({
      owner,
      repo,
      name: 'PR Annotate Regex',
      head_sha: headSha,
      status: 'completed',
      conclusion: 'neutral',
      output: {
        title: 'Regex Annotation Results',
        summary: `${annotations.length} annotations created.`,
        annotations,
      },
    });
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
