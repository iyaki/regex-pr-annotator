import { vi } from 'vitest';
import github from '@actions/github';

// Helper to mock github.context.repo for Vitest
export function mockRepoGetter() {
  vi.spyOn(github.context, 'repo', 'get').mockReturnValue({ owner: 'owner', repo: 'repo' });
}
