import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { runWithContext } from './log-context';

export const REQUEST_ID_HEADER = 'X-Request-Id';

/**
 * What an id sent by the caller may look like. The header is untrusted and ends up in log output,
 * so anything else (a space, a line break, too long) is replaced and never logged.
 */
const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Gives every request an id: the caller's `X-Request-Id` if it is a valid one, a new UUID
 * otherwise. The id is set on the response and added to the log lines written while the request is
 * served.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const sent = req.headers['x-request-id'];
  const requestId = typeof sent === 'string' && VALID_REQUEST_ID.test(sent) ? sent : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, requestId);
  runWithContext({ requestId }, next);
}
