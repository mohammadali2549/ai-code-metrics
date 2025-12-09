import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  cancelSubscription,
  changeSubscriptionPlan,
  SubscriptionStatusFilter,
  UiSubscriptionStatusFilter,
  viewAllSubscriptions,
  viewSubscriptionDetails,
} from './app';

interface ChangePlanBody {
  targetProductId: number;
  immediate?: boolean;
}

interface CancelSubscriptionBody {
  immediate?: boolean;
  cancellationReason?: string;
}

@Controller('subscriptions')
export class SubscriptionsController {
  @Get()
  async list(
    @Query('status') status?: UiSubscriptionStatusFilter,
    @Query('search') search?: string,
  ) {
    const normalizedStatus: SubscriptionStatusFilter | undefined =
      !status || status === 'all' ? undefined : (status as SubscriptionStatusFilter);

    return viewAllSubscriptions(normalizedStatus, search);
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    return viewSubscriptionDetails(Number(id));
  }

  @Post(':id/change-plan')
  async changePlan(
    @Param('id') id: string,
    @Body() body: ChangePlanBody,
  ) {
    const immediate = body.immediate ?? true;
    return changeSubscriptionPlan(Number(id), body.targetProductId, immediate);
  }

  @Post(':id/cancel')
  async cancel(
    @Param('id') id: string,
    @Body() body: CancelSubscriptionBody,
  ) {
    const immediate = body.immediate ?? false;
    return cancelSubscription(Number(id), immediate, body.cancellationReason);
  }
}


