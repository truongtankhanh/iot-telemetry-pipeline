import { AlertsController } from './alerts/alerts.controller';
import { DevicesController } from './devices/devices.controller';
import { HealthController } from './health/health.controller';

/**
 * Every HTTP controller of the service, in one list that both `AppModule` and the OpenAPI generator
 * (`openapi/openapi.module.ts`) use. A controller added here is in the service and in the document;
 * it cannot be in one and missing from the other.
 *
 * Its own file because importing `app.module.ts` validates the environment (`ConfigModule.forRoot`),
 * which the generator must not need.
 */
export const HTTP_CONTROLLERS = [DevicesController, AlertsController, HealthController];
