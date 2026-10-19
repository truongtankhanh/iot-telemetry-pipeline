import { currentContext, runWithContext } from './log-context';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('the log context', () => {
  it('is empty outside runWithContext', () => {
    expect(currentContext()).toEqual({});
  });

  it('holds the fields inside, and runWithContext returns what the callback returns', () => {
    const result = runWithContext({ requestId: 'r-1' }, () => {
      expect(currentContext()).toEqual({ requestId: 'r-1' });
      return 'done';
    });

    expect(result).toBe('done');
    expect(currentContext()).toEqual({});
  });

  it('survives an await and a timer', async () => {
    const seen = await runWithContext({ requestId: 'r-1' }, async () => {
      await delay(5);
      const afterAwait = currentContext().requestId;
      const afterTimer = await new Promise<string | undefined>((resolve) =>
        setTimeout(() => resolve(currentContext().requestId), 5),
      );
      return [afterAwait, afterTimer];
    });

    expect(seen).toEqual(['r-1', 'r-1']);
  });

  it('merges a nested context into the outer one and restores the outer one afterwards', () => {
    runWithContext({ requestId: 'r-1' }, () => {
      runWithContext({ batchId: '7' }, () => {
        expect(currentContext()).toEqual({ requestId: 'r-1', batchId: '7' });
      });

      expect(currentContext()).toEqual({ requestId: 'r-1' });
    });
  });

  it('lets an inner value replace the same field of the outer context', () => {
    runWithContext({ requestId: 'outer' }, () => {
      runWithContext({ requestId: 'inner' }, () => {
        expect(currentContext().requestId).toBe('inner');
      });

      expect(currentContext().requestId).toBe('outer');
    });
  });

  it('keeps two concurrent runs apart', async () => {
    const slow = runWithContext({ requestId: 'a' }, async () => {
      await delay(30);
      return currentContext().requestId;
    });
    const fast = runWithContext({ requestId: 'b' }, async () => {
      await delay(5);
      return currentContext().requestId;
    });

    await expect(Promise.all([slow, fast])).resolves.toEqual(['a', 'b']);
  });
});
