import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as path from 'path';
import * as fs from 'fs';

import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  app.enableCors({
    origin: process.env.CORS_ORIGINS?.split(',').map((s) => s.trim()) || '*',
    credentials: false,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  const reflector = app.get(Reflector);
  app.useGlobalInterceptors(new ResponseInterceptor(reflector));

  const config = new DocumentBuilder()
    .setTitle('TruCycle API')
    .setDescription('TruCycle REST API')
    .setVersion('0.1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Paste token only — no Bearer, no quotes.',
      },
      'bearer',
    )
    .build();
  const document = SwaggerModule.createDocument(app, config);

  // Serve static assets for Swagger customization (e.g., top link script)
  // Try both CWD/public (dev) and dist/public (prod)
  const staticCandidates = [
    path.join(process.cwd(), 'public'),
    path.join(__dirname, '..', 'public'),
  ];
  for (const dir of staticCandidates) {
    if (fs.existsSync(dir)) {
      app.useStaticAssets(dir);
      break;
    }
  }

  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
    customSiteTitle: 'TruCycle API Docs',
    // Inject a small script to add an OpenAPI JSON link in the topbar
    customJs: '/swagger-custom.js',
  });

  // Expose the OpenAPI document as JSON for download
  const httpAdapter = app.getHttpAdapter();
  httpAdapter.get('/openapi.json', (_req: any, res: any) => {
    res.type('application/json').send(document);
  });

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(
    `API running on http://localhost:${port} (docs at /docs, OpenAPI JSON at /openapi.json)`,
  );
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to bootstrap application', err);
  process.exit(1);
});
