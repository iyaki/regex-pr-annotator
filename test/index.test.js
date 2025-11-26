const core = require('@actions/core');
const github = require('@actions/github');
const path = require('path');
const { loadRules, run } = require('../index');

jest.mock('@actions/core');
jest.mock('@actions/github');

describe('regex-pr-annotator', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('loadRules', () => {
    it('should load rules from a JSON string', async () => {
      const rules = '[{"regex": "foo", "level": "error"}]';
      const loaded = await loadRules(rules);
      expect(loaded).toEqual([{ regex: 'foo', level: 'error' }]);
    });

    it('should throw if JSON is not an array', async () => {
      await expect(loadRules('{}')).rejects.toThrow('`rules` must be a JSON array');
    });

    it('should load rules from a JS file', async () => {
      const rulesPath = path.join(__dirname, '../test/rules-sample.js');
      // Create a dummy rules file for testing if it doesn't exist or mock require
      // Since we are running in the actual environment, let's assume the file exists or create a temp one.
      // Actually, let's mock the file require if possible, but loadRules uses require() dynamically.
      // For simplicity in this environment, let's rely on the existing sample files or create one.
      
      // Let's create a temporary file for this test to be robust
      const fs = require('fs');
      const tempRulesPath = path.join(__dirname, 'temp-rules.js');
      fs.writeFileSync(tempRulesPath, 'module.exports = [{ regex: "temp", level: "notice" }]');
      
      try {
        const loaded = await loadRules(tempRulesPath);
        expect(loaded).toEqual([{ regex: 'temp', level: 'notice' }]);
      } finally {
        fs.unlinkSync(tempRulesPath);
      }
    });
  });

  describe('run', () => {
    it('should fail if no token is provided', async () => {
      core.getInput.mockReturnValueOnce(''); // github_token
      await run();
      expect(core.setFailed).toHaveBeenCalledWith('GitHub token is required');
    });

    it('should fail if not a PR event', async () => {
      core.getInput.mockImplementation((name) => {
        if (name === 'github_token') return 'fake-token';
        if (name === 'rules') return '[]';
        return '';
      });
      github.context.payload = {};
      await run();
      expect(core.setFailed).toHaveBeenCalledWith('Action must be run on pull_request events.');
    });

    it('should process files and find matches', async () => {
      core.getInput.mockImplementation((name) => {
        if (name === 'github_token') return 'fake-token';
        if (name === 'rules') return JSON.stringify([{ regex: 'TODO', level: 'warning' }]);
        return '';
      });
      
      github.context.payload = {
        pull_request: { number: 123 }
      };
      github.context.repo = { owner: 'owner', repo: 'repo' };
      
      const mockOctokit = {
        rest: {
          pulls: {
            listFiles: jest.fn().mockResolvedValue({
              data: [
                {
                  filename: 'test.js',
                  patch: '@@ -1,1 +1,2 @@\n+TODO: fix this\n+const a = 1;'
                }
              ]
            })
          }
        }
      };
      github.getOctokit.mockReturnValue(mockOctokit);

      await run();

      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining('Line matches regex "TODO"'),
        expect.objectContaining({ file: 'test.js' })
      );
    });

    it('should fail with invalid fail_level', async () => {
      core.getInput.mockImplementation((name) => {
        if (name === 'github_token') return 'fake-token';
        if (name === 'rules') return '[]';
        if (name === 'fail_level') return 'invalid';
        return '';
      });
      await run();
      expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('Invalid fail_level'));
    });

    it('should fail when fail_level is set and matching level found', async () => {
      core.getInput.mockImplementation((name) => {
        if (name === 'github_token') return 'fake-token';
        if (name === 'rules') return JSON.stringify([{ regex: 'ERROR', level: 'error' }]);
        if (name === 'fail_level') return 'error';
        return '';
      });

      github.context.payload = { pull_request: { number: 123 } };
      github.context.repo = { owner: 'owner', repo: 'repo' };

      const mockOctokit = {
        rest: {
          pulls: {
            listFiles: jest.fn().mockResolvedValue({
              data: [{ filename: 'test.js', patch: '@@ -1,1 +1,2 @@\n+ERROR: bad code\n' }]
            })
          }
        }
      };
      github.getOctokit.mockReturnValue(mockOctokit);

      await run();

      expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('fail_level'));
    });

    it('should not fail when fail_level is higher than matched level', async () => {
      core.getInput.mockImplementation((name) => {
        if (name === 'github_token') return 'fake-token';
        if (name === 'rules') return JSON.stringify([{ regex: 'INFO', level: 'notice' }]);
        if (name === 'fail_level') return 'error';
        return '';
      });

      github.context.payload = { pull_request: { number: 123 } };
      github.context.repo = { owner: 'owner', repo: 'repo' };

      const mockOctokit = {
        rest: {
          pulls: {
            listFiles: jest.fn().mockResolvedValue({
              data: [{ filename: 'test.js', patch: '@@ -1,1 +1,2 @@\n+INFO: something\n' }]
            })
          }
        }
      };
      github.getOctokit.mockReturnValue(mockOctokit);

      await run();

      expect(core.setFailed).not.toHaveBeenCalledWith(expect.stringContaining('fail_level'));
    });

    it('should fail with invalid rule level', async () => {
      core.getInput.mockImplementation((name) => {
        if (name === 'github_token') return 'fake-token';
        if (name === 'rules') return JSON.stringify([{ regex: 'BAD', level: 'invalid' }]);
        return '';
      });

      github.context.payload = { pull_request: { number: 123 } };
      github.context.repo = { owner: 'owner', repo: 'repo' };

      const mockOctokit = {
        rest: {
          pulls: {
            listFiles: jest.fn().mockResolvedValue({
              data: [{ filename: 'test.js', patch: '@@ -1,1 +1,2 @@\n+BAD code\n' }]
            })
          }
        }
      };
      github.getOctokit.mockReturnValue(mockOctokit);

      await run();

      expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('Invalid level'));
    });

    it('should filter files by paths regex', async () => {
      core.getInput.mockImplementation((name) => {
        if (name === 'github_token') return 'fake-token';
        if (name === 'rules') return JSON.stringify([
          { regex: 'FIXME', level: 'warning', paths: ['src/.*\\.js'] }
        ]);
        return '';
      });

      github.context.payload = { pull_request: { number: 123 } };
      github.context.repo = { owner: 'owner', repo: 'repo' };

      const mockOctokit = {
        rest: {
          pulls: {
            listFiles: jest.fn().mockResolvedValue({
              data: [
                { filename: 'src/app.js', patch: '@@ -1,1 +1,2 @@\n+FIXME: in src\n' },
                { filename: 'test/test.js', patch: '@@ -1,1 +1,2 @@\n+FIXME: in test\n' }
              ]
            })
          }
        }
      };
      github.getOctokit.mockReturnValue(mockOctokit);

      await run();

      expect(core.warning).toHaveBeenCalledTimes(1);
      expect(core.warning).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ file: 'src/app.js' })
      );
    });

    it('should substitute message template variables', async () => {
      core.getInput.mockImplementation((name) => {
        if (name === 'github_token') return 'fake-token';
        if (name === 'rules') return JSON.stringify([
          { regex: 'PATTERN_(\\w+)', level: 'error', message: 'Found {regex} matching {match} in line: {line}' }
        ]);
        return '';
      });

      github.context.payload = { pull_request: { number: 123 } };
      github.context.repo = { owner: 'owner', repo: 'repo' };

      const mockOctokit = {
        rest: {
          pulls: {
            listFiles: jest.fn().mockResolvedValue({
              data: [
                { filename: 'test.js', patch: '@@ -1,1 +1,2 @@\n+PATTERN_ABC test\n' }
              ]
            })
          }
        }
      };
      github.getOctokit.mockReturnValue(mockOctokit);

      await run();

      expect(core.error).toHaveBeenCalledWith(
        expect.stringContaining('Found PATTERN_(\\w+)'),
        expect.anything()
      );
      expect(core.error).toHaveBeenCalledWith(
        expect.stringContaining('matching PATTERN_ABC'),
        expect.anything()
      );
    });

    it('should output findings table to console', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      core.getInput.mockImplementation((name) => {
        if (name === 'github_token') return 'fake-token';
        if (name === 'rules') return JSON.stringify([{ regex: 'BUG', level: 'error' }]);
        return '';
      });

      github.context.payload = { pull_request: { number: 123 } };
      github.context.repo = { owner: 'owner', repo: 'repo' };

      const mockOctokit = {
        rest: {
          pulls: {
            listFiles: jest.fn().mockResolvedValue({
              data: [{ filename: 'bug.js', patch: '@@ -1,1 +1,2 @@\n+BUG here\n' }]
            })
          }
        }
      };
      github.getOctokit.mockReturnValue(mockOctokit);

      await run();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Regex PR Annotator Findings'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('LEVEL'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('LOCATION'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('MESSAGE'));

      consoleSpy.mockRestore();
    });

    it('should enable debug output when debug is true', async () => {
      core.getInput.mockImplementation((name) => {
        if (name === 'github_token') return 'fake-token';
        if (name === 'rules') return JSON.stringify([{ regex: 'DEBUG', level: 'notice' }]);
        if (name === 'debug') return 'true';
        return '';
      });

      github.context.payload = { pull_request: { number: 123 } };
      github.context.repo = { owner: 'owner', repo: 'repo' };

      const mockOctokit = {
        rest: {
          pulls: {
            listFiles: jest.fn().mockResolvedValue({
              data: [{ filename: 'test.js', patch: '@@ -1,1 +1,2 @@\n+DEBUG test\n' }]
            })
          }
        }
      };
      github.getOctokit.mockReturnValue(mockOctokit);

      await run();

      expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Parsed rules'));
    });

    it('should handle files without patches', async () => {
      core.getInput.mockImplementation((name) => {
        if (name === 'github_token') return 'fake-token';
        if (name === 'rules') return JSON.stringify([{ regex: 'BUG', level: 'error' }]);
        return '';
      });

      github.context.payload = { pull_request: { number: 123 } };
      github.context.repo = { owner: 'owner', repo: 'repo' };

      const mockOctokit = {
        rest: {
          pulls: {
            listFiles: jest.fn().mockResolvedValue({
              data: [{ filename: 'binary.png' }] // No patch
            })
          }
        }
      };
      github.getOctokit.mockReturnValue(mockOctokit);

      await run();

      expect(core.error).not.toHaveBeenCalled();
    });

    it('should use default message when not provided', async () => {
      core.getInput.mockImplementation((name) => {
        if (name === 'github_token') return 'fake-token';
        if (name === 'rules') return JSON.stringify([{ regex: 'TEST', level: 'notice' }]);
        return '';
      });

      github.context.payload = { pull_request: { number: 123 } };
      github.context.repo = { owner: 'owner', repo: 'repo' };

      const mockOctokit = {
        rest: {
          pulls: {
            listFiles: jest.fn().mockResolvedValue({
              data: [{ filename: 'test.js', patch: '@@ -1,1 +1,2 @@\n+TEST code\n' }]
            })
          }
        }
      };
      github.getOctokit.mockReturnValue(mockOctokit);

      await run();

      expect(core.notice).toHaveBeenCalledWith(
        expect.stringContaining('Line matches regex'),
        expect.anything()
      );
    });
  });
});
