import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors(); // Enable CORS for WebSocket and HTTP

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT') || 3001;
  const jwtSecret = configService.get<string>('SUPABASE_JWT_SECRET');

  if (!jwtSecret) {
    throw new Error('CRITICAL ERROR: SUPABASE_JWT_SECRET is not loaded! Check your .env file.');
  }

  console.log(`SUPABASE_JWT_SECRET loaded: ${jwtSecret ? 'YES' : 'NO'}`);
  console.log(`JWT Secret length: ${jwtSecret.length}`);

  await app.listen(port);
  console.log(`Application is running on: ${await app.getUrl()}`);
}
bootstrap();
