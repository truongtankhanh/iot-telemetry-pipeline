import { ApiProperty } from '@nestjs/swagger';

/**
 * The body of an error answered by the framework: a validation failure, or an exception the handler
 * throws. `message` is an array of strings when the request pipe refuses the query (one per problem),
 * and a string when a handler refuses it or reports a missing device.
 *
 * It only describes; nothing builds it. The `503` of `/api/ready` is not this shape (see
 * `NotReadyResponse`).
 */
export class ErrorResponse {
  @ApiProperty({ example: 400 })
  statusCode: number;

  /** The name of the status, as Nest writes it. */
  @ApiProperty({ example: 'Bad Request' })
  error: string;

  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    example: ['metric must be one of the following values: temperature_c, humidity_pct'],
  })
  message: string | string[];
}
