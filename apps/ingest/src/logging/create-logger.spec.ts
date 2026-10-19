import { createLogger } from './create-logger';

const ESC = String.fromCharCode(27);

describe('createLogger', () => {
  let stdout: jest.SpyInstance;
  let stderr: jest.SpyInstance;
  const savedLevel = process.env.NEST_LOG_LEVEL;

  beforeEach(() => {
    stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (savedLevel === undefined) delete process.env.NEST_LOG_LEVEL;
    else process.env.NEST_LOG_LEVEL = savedLevel;
  });

  /** Everything written to a stream so far, as one string. */
  const written = (spy: jest.SpyInstance): string =>
    spy.mock.calls.map((call) => String(call[0])).join('');

  describe("'json'", () => {
    it('writes one parseable object per line, with the level, message and context', () => {
      createLogger('json').log('hello', 'Ctx');

      expect(stdout).toHaveBeenCalledTimes(1);
      const line = written(stdout);
      expect(line.endsWith('\n')).toBe(true);
      expect(JSON.parse(line)).toMatchObject({ level: 'log', message: 'hello', context: 'Ctx' });
    });

    it('writes a warning to stdout and an error to stderr', () => {
      const logger = createLogger('json');

      logger.warn('careful', 'Ctx');
      logger.error('broken', 'Ctx');

      expect(JSON.parse(written(stdout))).toMatchObject({ level: 'warn', message: 'careful' });
      expect(JSON.parse(written(stderr))).toMatchObject({ level: 'error', message: 'broken' });
      expect(written(stdout)).not.toContain('broken');
    });

    it('serialises an Error the way the exception handler passes it', () => {
      createLogger('json').error(new Error('boom'), 'Ctx');

      const entry = JSON.parse(written(stderr));
      expect(entry.level).toBe('error');
      expect(entry.error).toMatchObject({ name: 'Error', message: 'boom' });
    });

    it('keeps a message with a newline on one line', () => {
      createLogger('json').log('first\nsecond', 'Ctx');

      const line = written(stdout);
      expect(stdout).toHaveBeenCalledTimes(1);
      expect(line.indexOf('\n')).toBe(line.length - 1);
      expect(JSON.parse(line).message).toBe('first\nsecond');
    });

    it('writes no colour codes', () => {
      createLogger('json').warn('plain', 'Ctx');

      expect(written(stdout)).not.toContain(ESC);
    });
  });

  describe("'text'", () => {
    it('writes a line that is not JSON and still carries the message', () => {
      createLogger('text').log('hello', 'Ctx');

      const line = written(stdout);
      expect(line).toContain('hello');
      expect(() => JSON.parse(line)).toThrow();
    });
  });

  describe.each(['json', 'text'] as const)('%s: NEST_LOG_LEVEL', (format) => {
    it('still sets the level, because the logger is given none of its own', () => {
      process.env.NEST_LOG_LEVEL = 'error';
      const logger = createLogger(format);

      logger.log('quiet', 'Ctx');
      logger.error('loud', 'Ctx');

      expect(written(stdout)).toBe('');
      expect(written(stderr)).toContain('loud');
    });
  });
});
