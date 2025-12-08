import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import {
  UiSubscriptionStatusFilter,
  ChangeSubscriptionWhen,
  CancelSubscriptionWhen,
} from '../app';

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get()
  findAll(
    @Query('status') status?: UiSubscriptionStatusFilter,
    @Query('q') search?: string,
  ) {
    return this.subscriptionsService.findAll(status, search);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.subscriptionsService.findOne(Number(id));
  }

  @Post(':id/change-plan')
  changePlan(
    @Param('id') id: string,
    @Body()
    body: {
      newProductId: number;
      when: ChangeSubscriptionWhen;
    },
  ) {
    return this.subscriptionsService.changePlan(
      Number(id),
      Number(body.newProductId),
      body.when,
    );
  }

  @Post(':id/cancel')
  cancel(
    @Param('id') id: string,
    @Body()
    body: {
      when: CancelSubscriptionWhen;
      reason?: string;
    },
  ) {
    return this.subscriptionsService.cancel(Number(id), body.when, body.reason);
  }
}


