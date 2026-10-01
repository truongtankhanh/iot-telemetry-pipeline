import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/** HTTP setup shared by main.ts and the e2e tests. */
export function configureApp(app: INestApplication): INestApplication {
  // /metrics stays at the root, where Prometheus expects it.
  app.setGlobalPrefix('api', { exclude: ['metrics'] });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableShutdownHooks();
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('IoT Telemetry Pipeline')
      .setDescription('Devices, readings, rollups and alerts. Prometheus metrics at /metrics.')
      .setVersion('0.1.0')
      .build(),
  );
  SwaggerModule.setup('api/docs', app, document);
  return app;
}
