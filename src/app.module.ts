import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ItemsModule } from './items/items.module';
import { SubscriptionsController } from './subscriptions.controller';

@Module({
  imports: [ItemsModule],
  controllers: [AppController, SubscriptionsController],
  providers: [AppService],
})
export class AppModule {}

