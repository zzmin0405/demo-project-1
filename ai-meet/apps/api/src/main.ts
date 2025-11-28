import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const corsOrigin = configService.get<string>('CORS_ORIGIN');

  if (corsOrigin) {
    app.enableCors({
      origin: '*',
      credentials: false,
      allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning'],
    });
    console.log(`CORS enabled for origins: ${corsOrigin}`);
  } else {
    app.enableCors(); // Default (allows all, but credentials might be limited)
    console.log('CORS enabled for ALL origins (Development Mode)');
  }
  const port = configService.get<number>('PORT') || 3002;
  const jwtSecret = configService.get<string>('SUPABASE_JWT_SECRET');

  if (!jwtSecret) {
    throw new Error('CRITICAL ERROR: SUPABASE_JWT_SECRET is not loaded! Check your .env file.');
  }

  console.log(`SUPABASE_JWT_SECRET loaded: ${jwtSecret ? 'YES' : 'NO'}`);
  console.log(`JWT Secret length: ${jwtSecret.length}`);

  await app.listen(port, '0.0.0.0');
  console.log(`Application is running on: ${await app.getUrl()}`);
}
bootstrap();
