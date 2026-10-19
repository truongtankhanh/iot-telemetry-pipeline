import { Controller, Get, type INestApplication, Logger, Param } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { createLogger } from './create-logger';
import { currentContext } from './log-context';
import { REQUEST_ID_HEADER, requestIdMiddleware } from './request-id.middleware';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs the middleware on a fake request, the way Node hands over headers (lower-case names). */
function run(header?: unknown) {
  const setHeader = jest.fn();
  const seenInNext: Array<string | undefined> = [];
  const next = jest.fn(() => {
    seenInNext.push(currentContext().requestId);
  });
  const req = { headers: header === undefined ? {} : { 'x-request-id': header } };

  requestIdMiddleware(
    req as unknown as Request,
    { setHeader } as unknown as Response,
    next as unknown as NextFunction,
  );

  return { setHeader, next, id: seenInNext[0] };
}

describe('requestIdMiddleware (the decision)', () => {
  it('names the header X-Request-Id', () => {
    expect(REQUEST_ID_HEADER).toBe('X-Request-Id');
  });

  it.each(['req-1', 'a.b_c-D9', 'x', 'x'.repeat(64)])('keeps a valid id: %s', (id) => {
    const { setHeader, next, id: seen } = run(id);

    expect(seen).toBe(id);
    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, id);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a space', 'a b'],
    ['a newline', 'a\nb'],
    ['a carriage return', 'a\rb'],
    ['65 characters', 'x'.repeat(65)],
    ['an empty string', ''],
    ['a comma (two ids joined by Node)', 'a, b'],
    ['markup', '<script>'],
    ['an array', ['a', 'b']],
  ])('replaces an id with %s', (_name, input) => {
    const { setHeader, next, id } = run(input);

    expect(id).toMatch(UUID);
    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, id);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('generates a different id for each request that sends none', () => {
    const first = run();
    const second = run();

    expect(first.id).toMatch(UUID);
    expect(second.id).toMatch(UUID);
    expect(first.id).not.toBe(second.id);
    expect(first.setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, first.id);
  });
});

@Controller()
class ProbeController {
  @Get('whoami')
  whoami() {
    return { id: currentContext().requestId };
  }

  @Get('slow/:ms')
  async slow(@Param('ms') ms: string) {
    await delay(Number(ms));
    return { id: currentContext().requestId };
  }

  @Get('boom')
  boom(): never {
    throw new Error('boom');
  }
}

describe('requestIdMiddleware (in an application)', () => {
  let app: INestApplication | undefined;
  let stdout: jest.SpyInstance;
  let stderr: jest.SpyInstance;

  beforeEach(async () => {
    stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const moduleRef = await Test.createTestingModule({ controllers: [ProbeController] }).compile();
    app = moduleRef.createNestApplication();
    app.use(requestIdMiddleware);
    app.useLogger(createLogger('json'));
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
    jest.restoreAllMocks();
  });

  const server = () => app!.getHttpServer();

  /** The JSON log lines written to one stream (anything else, such as a reporter, is ignored). */
  const jsonLines = (spy: jest.SpyInstance): Array<Record<string, unknown>> =>
    spy.mock.calls
      .map((call) => String(call[0]))
      .join('')
      .split('\n')
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line));

  it('echoes a valid inbound id, and the handler sees the same id', async () => {
    const res = await request(server())
      .get('/whoami')
      .set(REQUEST_ID_HEADER, 'trace-1')
      .expect(200);

    expect(res.headers['x-request-id']).toBe('trace-1');
    expect(res.body).toEqual({ id: 'trace-1' });
  });

  it('replaces an inbound id with a space in it, and the handler sees the replacement', async () => {
    const res = await request(server()).get('/whoami').set(REQUEST_ID_HEADER, 'bad id').expect(200);

    expect(res.headers['x-request-id']).toMatch(UUID);
    expect(res.body).toEqual({ id: res.headers['x-request-id'] });
  });

  it('gives a response no handler produced the header too', async () => {
    const res = await request(server()).get('/nothing').expect(404);

    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('keeps the id after an await in the handler', async () => {
    const res = await request(server())
      .get('/slow/10')
      .set(REQUEST_ID_HEADER, 'trace-2')
      .expect(200);

    expect(res.body).toEqual({ id: 'trace-2' });
  });

  it('does not mix up two requests that are served at the same time', async () => {
    await app!.listen(0);
    const { port } = app!.getHttpServer().address();
    const base = `http://127.0.0.1:${port}`;

    const [slow, fast] = await Promise.all([
      request(base).get('/slow/80').set(REQUEST_ID_HEADER, 'req-a'),
      request(base).get('/slow/10').set(REQUEST_ID_HEADER, 'req-b'),
    ]);

    expect(slow.body).toEqual({ id: 'req-a' });
    expect(fast.body).toEqual({ id: 'req-b' });
    expect(slow.headers['x-request-id']).toBe('req-a');
    expect(fast.headers['x-request-id']).toBe('req-b');
  });

  describe('the log lines', () => {
    it('puts the request id on the line Nest writes for a 500', async () => {
      const res = await request(server())
        .get('/boom')
        .set(REQUEST_ID_HEADER, 'trace-3')
        .expect(500);

      expect(res.headers['x-request-id']).toBe('trace-3');
      const entry = jsonLines(stderr).find((line) => line.message === 'boom');
      expect(entry).toMatchObject({ level: 'error', requestId: 'trace-3' });
    });

    it('puts no request id on a line written outside any request', async () => {
      await request(server()).get('/whoami').set(REQUEST_ID_HEADER, 'trace-4').expect(200);

      new Logger('Timer').log('tick');

      const entry = jsonLines(stdout).find((line) => line.message === 'tick');
      expect(entry).toMatchObject({ level: 'log', context: 'Timer' });
      expect(entry).not.toHaveProperty('requestId');
    });

    it('never writes the rejected inbound id, only its replacement', async () => {
      const res = await request(server()).get('/boom').set(REQUEST_ID_HEADER, 'bad id').expect(500);

      const everything = [stdout, stderr]
        .map((spy) => spy.mock.calls.map((call) => String(call[0])).join(''))
        .join('');
      expect(everything).not.toContain('bad id');
      const entry = jsonLines(stderr).find((line) => line.message === 'boom');
      expect(entry).toMatchObject({ requestId: res.headers['x-request-id'] });
    });
  });
});
