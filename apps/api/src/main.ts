import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  // rawBody: true preserves the raw request buffer (needed for Stripe webhook
  // signature verification) while still parsing JSON for normal routes.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });

  app.setGlobalPrefix('api');
  app.enableCors({ origin: true, credentials: true });

  // strip unknown props, coerce types, reject on extra fields
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  const config = new DocumentBuilder()
    .setTitle('Test Routify API')
    .setDescription('UK driving-route learning platform — business API')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  Logger.log(`Test Routify API on http://localhost:${port} (docs at /docs)`, 'Bootstrap');
}
bootstrap();
