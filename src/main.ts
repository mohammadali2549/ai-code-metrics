import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Enable CORS for Angular frontend (dev ports 4200 and 4300)
  app.enableCors({
    origin: ['http://localhost:4200', 'http://localhost:4300'],
    methods: 'GET,POST,PUT,DELETE',
    allowedHeaders: 'Content-Type, Authorization',
  });
  
  await app.listen(3000);
  console.log('Backend server running on http://localhost:3000');
}
bootstrap();

