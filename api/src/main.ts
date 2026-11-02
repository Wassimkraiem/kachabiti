import './instrument';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { config } from './config';

async function bootstrap() {
  // rawBody: the Meta webhook checks its signature over the exact bytes received.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  // Same URLs as the Next.js routes, so Next.js can rewrite /api/<area> here unchanged.
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  await app.listen(config.PORT);
}
void bootstrap();
