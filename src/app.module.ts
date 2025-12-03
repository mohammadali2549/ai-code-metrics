import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PayPalController, PayPalService } from './app';
import { ItemsModule } from './items/items.module';

@Module({
  imports: [ItemsModule],
  controllers: [AppController, PayPalController],
  providers: [AppService, PayPalService],
})
export class AppModule {}

