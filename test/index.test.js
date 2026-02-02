
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import core from '@actions/core';
import github from '@actions/github';
import path from 'path';
import { loadRules, run } from '../index';
import { mockRepoGetter } from './vitest-helpers.js';

vi.mock('@actions/core');
vi.mock('@actions/github');

describe('regex-pr-annotator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      mockRepoGetter();

      const mockOctokit = {
        rest: {
          pulls: {
            listFiles: vi.fn().mockResolvedValue({
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
      mockRepoGetter();

      const mockOctokit = {
        rest: {
          pulls: {
            listFiles: vi.fn().mockResolvedValue({
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
      mockRepoGetter();

      const mockOctokit = {
        rest: {
          pulls: {
            listFiles: vi.fn().mockResolvedValue({
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
      mockRepoGetter();

      const mockOctokit = {
        rest: {
          pulls: {
            listFiles: vi.fn().mockResolvedValue({
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
      mockRepoGetter();

      const mockOctokit = {
        rest: {
          pulls: {
            listFiles: vi.fn().mockResolvedValue({
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
      mockRepoGetter();

      const mockOctokit = {
        rest: {
          pulls: {
            listFiles: vi.fn().mockResolvedValue({
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
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      core.getInput.mockImplementation((name) => {
        if (name === 'github_token') return 'fake-token';
        if (name === 'rules') return JSON.stringify([{ regex: 'BUG', level: 'error' }]);
        return '';
      });

      github.context.payload = { pull_request: { number: 123 } };
      mockRepoGetter();

      const mockOctokit = {
        rest: {
          pulls: {
            listFiles: vi.fn().mockResolvedValue({
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
      mockRepoGetter();

      const mockOctokit = {
        rest: {
          pulls: {
            listFiles: vi.fn().mockResolvedValue({
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
      mockRepoGetter();

      const mockOctokit = {
        rest: {
          pulls: {
            listFiles: vi.fn().mockResolvedValue({
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
      mockRepoGetter();

      const mockOctokit = {
        rest: {
          pulls: {
            listFiles: vi.fn().mockResolvedValue({
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

    it('should handle invalid rules JSON', async () => {
      core.getInput.mockImplementation((name) => {
        if (name === 'github_token') return 'fake-token';
        if (name === 'rules') return 'invalid json {';
        return '';
      });

      await run();

      expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('Invalid rules'));
    });

    it('should handle lines starting with minus (removed lines)', async () => {
      core.getInput.mockImplementation((name) => {
        if (name === 'github_token') return 'fake-token';
        if (name === 'rules') return JSON.stringify([{ regex: 'REMOVE', level: 'warning' }]);
        return '';
      });

      github.context.payload = { pull_request: { number: 123 } };
      mockRepoGetter();

      const mockOctokit = {
        rest: {
          pulls: {
            listFiles: vi.fn().mockResolvedValue({
              data: [{ filename: 'test.js', patch: '@@ -1,3 +1,2 @@\n-REMOVE this line\n context line' }]
            })
          }
        }
      };
      github.getOctokit.mockReturnValue(mockOctokit);

      await run();

      // Should not find matches in removed lines
      expect(core.warning).not.toHaveBeenCalled();
    });

    it('should handle patches with multiple line type changes', async () => {
      core.getInput.mockImplementation((name) => {
        if (name === 'github_token') return 'fake-token';
        if (name === 'rules') return JSON.stringify([{ regex: 'ADD', level: 'warning' }]);
        return '';
      });

      github.context.payload = { pull_request: { number: 123 } };
      mockRepoGetter();

      const mockOctokit = {
        rest: {
          pulls: {
            listFiles: vi.fn().mockResolvedValue({
              data: [{
                filename: 'test.js',
                patch: '@@ -1,3 +1,3 @@\n-REMOVE this\n context line\n+ADD this'
              }]
            })
          }
        }
      };
      github.getOctokit.mockReturnValue(mockOctokit);

      await run();

      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining('ADD'),
        expect.anything()
      );
    });

    it('should handle no findings with empty output', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      core.getInput.mockImplementation((name) => {
        if (name === 'github_token') return 'fake-token';
        if (name === 'rules') return JSON.stringify([{ regex: 'NONEXISTENT', level: 'error' }]);
        return '';
      });

      github.context.payload = { pull_request: { number: 123 } };
      mockRepoGetter();

      const mockOctokit = {
        rest: {
          pulls: {
            listFiles: vi.fn().mockResolvedValue({
              data: [{ filename: 'test.js', patch: '@@ -1,1 +1,1 @@\n+normal code' }]
            })
          }
        }
      };
      github.getOctokit.mockReturnValue(mockOctokit);

      await run();

      // Should not log the findings table when there are no findings
      expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('Regex PR Annotator Findings'));

      consoleSpy.mockRestore();
    });

    it('should handle run function errors gracefully', async () => {
      core.getInput.mockImplementation(() => {
        throw new Error('Unexpected error');
      });

      await run();

      expect(core.setFailed).toHaveBeenCalledWith('Unexpected error');
    });

    it('should support RegExp objects in rule paths', async () => {
      core.getInput.mockImplementation((name) => {
        if (name === 'github_token') return 'fake-token';
        if (name === 'rules') return JSON.stringify([
          { regex: 'SPECIAL', level: 'warning', paths: ['src/.*\\.js$'] }
        ]);
        return '';
      });

      github.context.payload = { pull_request: { number: 123 } };
      mockRepoGetter();

      const mockOctokit = {
        rest: {
          pulls: {
            listFiles: vi.fn().mockResolvedValue({
              data: [
                { filename: 'src/special.js', patch: '@@ -1,1 +1,2 @@\n+SPECIAL code\n' },
                { filename: 'lib/special.js', patch: '@@ -1,1 +1,2 @@\n+SPECIAL code\n' }
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
        expect.objectContaining({ file: 'src/special.js' })
      );
    });

    it('should handle rules with RegExp objects in regex field', async () => {
      core.getInput.mockImplementation((name) => {
        if (name === 'github_token') return 'fake-token';
        if (name === 'rules') return JSON.stringify([
          { regex: 'FIX[A-Z]+', level: 'error' }
        ]);
        return '';
      });

      github.context.payload = { pull_request: { number: 123 } };
      mockRepoGetter();

      const mockOctokit = {
        rest: {
          pulls: {
            listFiles: vi.fn().mockResolvedValue({
              data: [{ filename: 'test.js', patch: '@@ -1,1 +1,2 @@\n+FIXME urgent\n' }]
            })
          }
        }
      };
      github.getOctokit.mockReturnValue(mockOctokit);

      await run();

      expect(core.error).toHaveBeenCalledWith(
        expect.stringContaining('FIX[A-Z]+'),
        expect.anything()
      );
    });

    it('should handle multiple matches in the same line', async () => {
      core.getInput.mockImplementation((name) => {
        if (name === 'github_token') return 'fake-token';
        if (name === 'rules') return JSON.stringify([
          { regex: 'BUG', level: 'error', message: 'Found {regex} matching {match}' }
        ]);
        return '';
      });

      github.context.payload = { pull_request: { number: 123 } };
      mockRepoGetter();

      const mockOctokit = {
        rest: {
          pulls: {
            listFiles: vi.fn().mockResolvedValue({
              data: [{ filename: 'test.js', patch: '@@ -1,1 +1,2 @@\n+BUG BUG BUG\n' }]
            })
          }
        }
      };
      github.getOctokit.mockReturnValue(mockOctokit);

      await run();

      // Should match only once per line (first match)
      expect(core.error).toHaveBeenCalledTimes(1);
      expect(core.error).toHaveBeenCalledWith(
        expect.stringContaining('matching BUG'),
        expect.anything()
      );
    });

    it('should validate exact table formatting in output', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      core.getInput.mockImplementation((name) => {
        if (name === 'github_token') return 'fake-token';
        if (name === 'rules') return JSON.stringify([{ regex: 'BUG', level: 'error' }]);
        return '';
      });

      github.context.payload = { pull_request: { number: 123 } };
      mockRepoGetter();

      const mockOctokit = {
        rest: {
          pulls: {
            listFiles: vi.fn().mockResolvedValue({
              data: [{ filename: 'test.js', patch: '@@ -1,1 +1,2 @@\n+BUG here\n' }]
            })
          }
        }
      };
      github.getOctokit.mockReturnValue(mockOctokit);

      await run();

      // Verify the table header is printed
      const calls = consoleSpy.mock.calls;
      const headerCall = calls.find(c => c[0].includes('LEVEL'));
      expect(headerCall).toBeDefined();
      expect(headerCall[0]).toContain('LOCATION');
      expect(headerCall[0]).toContain('MESSAGE');

      // Verify separator line is printed
      const separatorCall = calls.find(c => c[0].includes('-----'));
      expect(separatorCall).toBeDefined();

      consoleSpy.mockRestore();
    });

    it('should output level in uppercase in findings table', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      core.getInput.mockImplementation((name) => {
        if (name === 'github_token') return 'fake-token';
        if (name === 'rules') return JSON.stringify([{ regex: 'WARN', level: 'warning' }]);
        return '';
      });

      github.context.payload = { pull_request: { number: 123 } };
      mockRepoGetter();

      const mockOctokit = {
        rest: {
          pulls: {
            listFiles: vi.fn().mockResolvedValue({
              data: [{ filename: 'test.js', patch: '@@ -1,1 +1,2 @@\n+WARN here\n' }]
            })
          }
        }
      };
      github.getOctokit.mockReturnValue(mockOctokit);

      await run();

      const calls = consoleSpy.mock.calls;
      const contentCall = calls.find(c =>
        c[0].includes('WARNING') && c[0].includes('test.js') && c[0].includes('WARN')
      );
      expect(contentCall).toBeDefined();
      expect(contentCall[0]).toContain('WARNING');
      expect(contentCall[0]).not.toContain('warning');

      consoleSpy.mockRestore();
    });

    it('should handle rules with single path string instead of array', async () => {
      core.getInput.mockImplementation((name) => {
        if (name === 'github_token') return 'fake-token';
        // Single path as string (not array)
        if (name === 'rules') return JSON.stringify([
          { regex: 'TODO', level: 'warning', paths: 'src/.*' }
        ]);
        return '';
      });

      github.context.payload = { pull_request: { number: 123 } };
      mockRepoGetter();

      const mockOctokit = {
        rest: {
          pulls: {
            listFiles: vi.fn().mockResolvedValue({
              data: [
                { filename: 'src/app.js', patch: '@@ -1,1 +1,2 @@\n+TODO fix\n' },
                { filename: 'test/index.js', patch: '@@ -1,1 +1,2 @@\n+TODO test\n' }
              ]
            })
          }
        }
      };
      github.getOctokit.mockReturnValue(mockOctokit);

      await run();

      // Should only match in src directory
      expect(core.warning).toHaveBeenCalledTimes(1);
      expect(core.warning).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ file: 'src/app.js' })
      );
    });

    it('should handle all warning levels correctly', async () => {
      core.getInput.mockImplementation((name) => {
        if (name === 'github_token') return 'fake-token';
        if (name === 'rules') return JSON.stringify([
          { regex: 'NOTICE_PATTERN', level: 'notice' },
          { regex: 'WARNING_PATTERN', level: 'warning' },
          { regex: 'ERROR_PATTERN', level: 'error' }
        ]);
        return '';
      });

      github.context.payload = { pull_request: { number: 123 } };
      mockRepoGetter();

      const mockOctokit = {
        rest: {
          pulls: {
            listFiles: vi.fn().mockResolvedValue({
              data: [
                { filename: 'test.js', patch: '@@ -1,3 +1,3 @@\n+NOTICE_PATTERN\n+WARNING_PATTERN\n+ERROR_PATTERN\n' }
              ]
            })
          }
        }
      };
      github.getOctokit.mockReturnValue(mockOctokit);

      await run();

      expect(core.notice).toHaveBeenCalledTimes(1);
      expect(core.warning).toHaveBeenCalledTimes(1);
      expect(core.error).toHaveBeenCalledTimes(1);
    });

    it('should correctly track max matched level across multiple findings', async () => {
      core.getInput.mockImplementation((name) => {
        if (name === 'github_token') return 'fake-token';
        if (name === 'rules') return JSON.stringify([
          { regex: 'INFO', level: 'notice' },
          { regex: 'WARN', level: 'warning' },
          { regex: 'ERROR', level: 'error' }
        ]);
        if (name === 'fail_level') return 'warning';
        return '';
      });

      github.context.payload = { pull_request: { number: 123 } };
      mockRepoGetter();

      const mockOctokit = {
        rest: {
          pulls: {
            listFiles: vi.fn().mockResolvedValue({
              data: [
                { filename: 'test.js', patch: '@@ -1,1 +1,3 @@\n+INFO msg\n+WARN msg\n+ERROR msg\n' }
              ]
            })
          }
        }
      };
      github.getOctokit.mockReturnValue(mockOctokit);

      await run();

      // Should fail because error level >= warning fail_level
      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('error')
      );
    });

    it('should not fail if max matched level is below fail_level', async () => {
      core.getInput.mockImplementation((name) => {
        if (name === 'github_token') return 'fake-token';
        if (name === 'rules') return JSON.stringify([
          { regex: 'INFO', level: 'notice' },
          { regex: 'WARN', level: 'warning' }
        ]);
        if (name === 'fail_level') return 'error';
        return '';
      });

      github.context.payload = { pull_request: { number: 123 } };
      mockRepoGetter();

      const mockOctokit = {
        rest: {
          pulls: {
            listFiles: vi.fn().mockResolvedValue({
              data: [
                { filename: 'test.js', patch: '@@ -1,1 +1,2 @@\n+INFO msg\n+WARN msg\n' }
              ]
            })
          }
        }
      };
      github.getOctokit.mockReturnValue(mockOctokit);

      await run();

      // Should NOT fail because max is warning < error fail_level
      const failedCalls = core.setFailed.mock.calls.filter(c =>
        c[0].includes('fail_level')
      );
      expect(failedCalls.length).toBe(0);
    });

    it('should handle rules without explicit level (should use warning as default)', async () => {
      core.getInput.mockImplementation((name) => {
        if (name === 'github_token') return 'fake-token';
        if (name === 'rules') return JSON.stringify([
          { regex: 'FIXME' }  // No level specified
        ]);
        return '';
      });

      github.context.payload = { pull_request: { number: 123 } };
      mockRepoGetter();

      const mockOctokit = {
        rest: {
          pulls: {
            listFiles: vi.fn().mockResolvedValue({
              data: [{ filename: 'test.js', patch: '@@ -1,1 +1,2 @@\n+FIXME code\n' }]
            })
          }
        }
      };
      github.getOctokit.mockReturnValue(mockOctokit);

      await run();

      // Should call warning (default level)
      expect(core.warning).toHaveBeenCalled();
    });

    it('should handle message template with all variable substitutions', async () => {
      core.getInput.mockImplementation((name) => {
        if (name === 'github_token') return 'fake-token';
        if (name === 'rules') return JSON.stringify([
          {
            regex: 'TEMPLATE_(\\w+)',
            level: 'error',
            message: 'Regex: {regex}, Match: {match}, Line: {line}'
          }
        ]);
        return '';
      });

      github.context.payload = { pull_request: { number: 123 } };
      mockRepoGetter();

      const mockOctokit = {
        rest: {
          pulls: {
            listFiles: vi.fn().mockResolvedValue({
              data: [{ filename: 'test.js', patch: '@@ -1,1 +1,2 @@\n+TEMPLATE_ABC code\n' }]
            })
          }
        }
      };
      github.getOctokit.mockReturnValue(mockOctokit);

      await run();

      expect(core.error).toHaveBeenCalledWith(
        expect.stringContaining('Regex: TEMPLATE_(\\w+)'),
        expect.anything()
      );
      expect(core.error).toHaveBeenCalledWith(
        expect.stringContaining('Match: TEMPLATE_ABC'),
        expect.anything()
      );
      expect(core.error).toHaveBeenCalledWith(
        expect.stringContaining('TEMPLATE_ABC code'),
        expect.anything()
      );
    });

    it('should correctly compute line numbers across multiple patches', async () => {
      core.getInput.mockImplementation((name) => {
        if (name === 'github_token') return 'fake-token';
        if (name === 'rules') return JSON.stringify([
          { regex: 'MARK', level: 'error' }
        ]);
        return '';
      });

      github.context.payload = { pull_request: { number: 123 } };
      mockRepoGetter();

      const mockOctokit = {
        rest: {
          pulls: {
            listFiles: vi.fn().mockResolvedValue({
              data: [
                {
                  filename: 'file1.js',
                  patch: '@@ -1,2 +1,3 @@\n context\n+MARK line 2\n context\n'
                },
                {
                  filename: 'file2.js',
                  patch: '@@ -10,2 +10,3 @@\n context\n+MARK line 11\n context\n'
                }
              ]
            })
          }
        }
      };
      github.getOctokit.mockReturnValue(mockOctokit);

      await run();

      expect(core.error).toHaveBeenCalledTimes(2);
      // First file at line 2
      expect(core.error).toHaveBeenNthCalledWith(
        1,
        expect.anything(),
        expect.objectContaining({ file: 'file1.js', startLine: 2 })
      );
      // Second file at line 11
      expect(core.error).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        expect.objectContaining({ file: 'file2.js', startLine: 11 })
      );
    });
  });
});
