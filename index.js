const core = require('@actions/core')
const github = require('@actions/github')

async function run() {
  try {
    const token = core.getInput('github_token')
    if (!token) {
      core.setFailed('GitHub token is required')
      return;
    }
    const debug = core.getInput('debug') === 'true'
    const failLevelInput = core.getInput('fail_level') || 'none'
    const validLevels = ['notice', 'warning', 'error']
    const failLevel = failLevelInput.toLowerCase()
    if (failLevel !== 'none' && !validLevels.includes(failLevel)) {
      core.setFailed(`Invalid fail_level '${failLevel}'. Must be one of none, notice, warning, or error.`)
      return
    }
    // failLevelRank: none=-1, notice=0, warning=1, error=2
    const failLevelRank = failLevel === 'none' ? -1 : validLevels.indexOf(failLevel)
    let maxMatchedLevel = -1

    const rulesInput = core.getInput('rules', { required: true })
    let rules
    try {
      rules = JSON.parse(rulesInput)
      if (!Array.isArray(rules)) throw new Error('`rules` must be a JSON array')
    } catch (err) {
      core.setFailed(`Invalid JSON for rules: ${err.message}`)
      return
    }
    if (debug) core.info(`Parsed rules: ${JSON.stringify(rules)}`)

    const context = github.context

    if (!context.payload.pull_request) {
      core.setFailed('Action must be run on pull_request events.')
      return
    }

    const { owner, repo } = context.repo
    const prNumber = context.payload.pull_request.number
    const octokit = github.getOctokit(token)

    const { data: files } = await octokit.rest.pulls.listFiles({ owner, repo, pull_number: prNumber })

    let findings = []

    for (const file of files) {
      if (!file.patch) continue
      if (debug) {
        core.info(`Processing file: ${file.filename}\nPatch:\n${file.patch}`)
      }
      const lines = file.patch.split('\n')
      let newLine = 0
      for (const line of lines) {
        // Match Git unified diff headers to track line numbers. The first part of
        // the regex (`^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@`) matches the entire
        // header, and the \+(\d+) part captures the line number that the current
        // block of lines starts on in the resulting file. The exec() method
        // returns an array where the first element is the full match and the
        // second element is the captured group, which is the line number.
        const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
        if (header) {
          newLine = parseInt(header[1], 10) - 1

        // Added lines
        } else if (line.startsWith('+') && !line.startsWith('+++')) {
          newLine++
          const text = line.slice(1)
          for (const rule of rules) {
            if (rule.paths) {
              const patterns = Array.isArray(rule.paths) ? rule.paths : [rule.paths]
              if (!patterns.some(p => new RegExp(p).test(file.filename))) {
                continue
              }
            }

            const lvl = rule['level'] || 'warning'
            if (!validLevels.includes(lvl)) {
              core.setFailed(`Invalid level '${lvl}'. Must be one of notice, warning, or error.`)
              return
            }

            const re = new RegExp(rule.regex)
            if (re.test(text)) {
              const msgTemplate = rule.message || 'Line matches regex "{regex}"'
              const matchRes = text.match(re)
              const matchedText = matchRes ? matchRes[0] : ''
              const message = msgTemplate
                .replace('{regex}', rule.regex)
                .replace('{line}', text)
                .replace('{match}', matchedText)

              core[lvl](message, { file: file.filename, startLine: newLine })

              // Save finding to display at the end
              findings.push({
                level: lvl,
                file: file.filename,
                line: newLine,
                message
              })

              // Track max matched level
              const lvlRank = validLevels.indexOf(lvl)
              if (lvlRank > maxMatchedLevel) maxMatchedLevel = lvlRank
              if (debug) {
                core.info(`[debug] Matched rule ${rule.regex} in ${file.filename} at line ${newLine}: ${matchedText}`)
              }
            }
          }

        // Removed lines
        } else if (!line.startsWith('-')) {
          ++newLine
        }
      }
    }
    // Fail if any annotation matches or exceeds fail_level
    if (failLevelRank >= 0 && maxMatchedLevel >= failLevelRank) {
      console.log('\n');
      core.setFailed(`❌ Regex PR Annotator: Findings with level '${validLevels[maxMatchedLevel]}' or higher were detected (fail_level: '${failLevel}').\nPlease review the findings listed above and address the issues before continuing.`)
    }

    if (findings.length > 0) {
      console.log('\n================ Regex PR Annotator Findings ================')
      // Calculate column widths
      const levelWidth = Math.max(5, ...findings.map(f => f.level.length))
      const locationWidth = Math.max(12, ...findings.map(f => `${f.file}:${f.line}`.length))
      // Header
      console.log(
        `${'LEVEL'.padEnd(levelWidth)} | ${'LOCATION'.padEnd(locationWidth)} | MESSAGE`
      )
      console.log('-'.repeat(levelWidth + locationWidth + 13 + 5))
      // Rows
      for (const f of findings) {
        const location = `${f.file}:${f.line}`
        console.log(
          `${f.level.toUpperCase().padEnd(levelWidth)} | ${location.padEnd(locationWidth)} | ${f.message}`
        )
      }
      console.log('============================================================\n')
    }
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
