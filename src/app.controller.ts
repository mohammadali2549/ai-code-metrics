import { Controller, Get, Query } from '@nestjs/common';
import { AppService } from './app.service';
import { viewAllSubscriptions, UiSubscriptionStatusFilter } from './app';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('subscriptions')
  async getSubscriptions(
    @Query('status') status?: UiSubscriptionStatusFilter,
    @Query('search') search?: string,
  ) {
    return viewAllSubscriptions(status, search);
  }
}

