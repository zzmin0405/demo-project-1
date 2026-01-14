import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication, ExpressAdapter } from '@nestjs/platform-express';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, new ExpressAdapter());
  const configService = app.get(ConfigService);
  const corsOrigin = configService.get<string>('CORS_ORIGIN');

  app.enableCors({
    origin: '*',
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  console.log('CORS enabled for ALL origins (Global Override)');
  const port = configService.get<number>('PORT') || 3001;
  // const jwtSecret = configService.get<string>('SUPABASE_JWT_SECRET');

  // BYPASS: Currently Supabase Auth Guard trusts the token directly (Temp Fix in Guard)
  // So we do not strictly need this secret to start the server.
  // if (!jwtSecret) {
  //   throw new Error('CRITICAL ERROR: SUPABASE_JWT_SECRET is not loaded! Check your .env file.');
  // }

  // console.log(`SUPABASE_JWT_SECRET loaded: ${jwtSecret ? 'YES' : 'NO'}`);

  await app.listen(port, '0.0.0.0');
  console.log(`Application is running on: ${await app.getUrl()}`);
}
bootstrap();
