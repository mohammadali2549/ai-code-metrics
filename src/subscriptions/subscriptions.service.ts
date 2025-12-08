import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import {
  SubscriptionDetails,
  SubscriptionSummary,
  UiSubscriptionStatusFilter,
  ChangeSubscriptionWhen,
  CancelSubscriptionWhen,
  getSubscriptionDetails,
  viewAllSubscriptions,
  changeSubscriptionPlan,
  cancelSubscriptionCore,
} from '../app';

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  async findAll(
    status?: UiSubscriptionStatusFilter,
    search?: string,
  ): Promise<SubscriptionSummary[]> {
    try {
      return await viewAllSubscriptions(status, search);
    } catch (error: any) {
      // Avoid surfacing low-level Maxio or configuration errors as 500s for the
      // list endpoint. Log the error and return an empty list so the frontend
      // can still render gracefully.
      this.logger.error(
        `Failed to load subscriptions from Maxio: ${error?.message || error}`,
      );
      return [];
    }
  }

  async findOne(id: number): Promise<SubscriptionDetails> {
    return getSubscriptionDetails(id);
  }

  async changePlan(
    id: number,
    newProductId: number,
    when: ChangeSubscriptionWhen,
  ): Promise<unknown> {
    try {
      return await changeSubscriptionPlan(id, newProductId, when);
    } catch (error: any) {
      const message = error?.message || String(error);
      this.logger.error(
        `Failed to change subscription plan for ${id}: ${message}`,
      );

      if (message.includes('Missing Maxio configuration')) {
        throw new BadRequestException(
          'Subscription provider is not configured. Please set MAXIO_* environment variables.',
        );
      }

      throw new InternalServerErrorException(
        'Failed to change subscription plan. See server logs for details.',
      );
    }
  }

  async cancel(
    id: number,
    when: CancelSubscriptionWhen,
    reason?: string,
  ): Promise<unknown> {
    try {
      return await cancelSubscriptionCore(id, when, reason);
    } catch (error: any) {
      const message = error?.message || String(error);
      this.logger.error(`Failed to cancel subscription ${id}: ${message}`);

      if (message.includes('Missing Maxio configuration')) {
        throw new BadRequestException(
          'Subscription provider is not configured. Please set MAXIO_* environment variables.',
        );
      }

      throw new InternalServerErrorException(
        'Failed to cancel subscription. See server logs for details.',
      );
    }
  }
}


