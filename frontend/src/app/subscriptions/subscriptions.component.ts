import { Component, OnInit } from '@angular/core';
import {
  CancelSubscriptionWhen,
  ChangeSubscriptionWhen,
  SubscriptionDetails,
  SubscriptionListItem,
  SubscriptionService,
  UiSubscriptionStatusFilter,
} from '../services/subscription.service';

@Component({
  selector: 'app-subscriptions',
  templateUrl: './subscriptions.component.html',
  styleUrls: ['./subscriptions.component.css'],
})
export class SubscriptionsComponent implements OnInit {
  subscriptions: SubscriptionListItem[] = [];
  selectedSubscription?: SubscriptionDetails;

  statusFilter: UiSubscriptionStatusFilter = 'all';
  searchTerm = '';

  loadingList = false;
  loadingDetails = false;
  actionInProgress = false;
  errorMessage = '';
  successMessage = '';

  // Change plan state
  newPlanProductId?: number;
  changeWhen: ChangeSubscriptionWhen = 'immediately';

  // Cancel subscription state
  cancelWhen: CancelSubscriptionWhen = 'period_end';
  cancelReason = '';

  constructor(private subscriptionService: SubscriptionService) {}

  ngOnInit(): void {
    this.loadSubscriptions();
  }

  loadSubscriptions(): void {
    this.loadingList = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.subscriptionService
      .getSubscriptions(this.statusFilter, this.searchTerm)
      .subscribe({
        next: (data) => {
          this.subscriptions = data;
          this.loadingList = false;
        },
        error: () => {
          this.errorMessage = 'Failed to load subscriptions.';
          this.loadingList = false;
        },
      });
  }

  selectSubscription(sub: SubscriptionListItem): void {
    if (!sub.id) {
      return;
    }

    this.loadingDetails = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.subscriptionService.getSubscriptionDetails(sub.id).subscribe({
      next: (details) => {
        this.selectedSubscription = details;
        this.loadingDetails = false;
        this.newPlanProductId = undefined;
        this.changeWhen = 'immediately';
        this.cancelWhen = 'period_end';
        this.cancelReason = '';
      },
      error: () => {
        this.errorMessage = 'Failed to load subscription details.';
        this.loadingDetails = false;
      },
    });
  }

  applyFilters(): void {
    this.loadSubscriptions();
  }

  changePlan(): void {
    if (!this.selectedSubscription || !this.selectedSubscription.id || !this.newPlanProductId) {
      return;
    }

    this.actionInProgress = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.subscriptionService
      .changeSubscriptionPlan(
        this.selectedSubscription.id,
        this.newPlanProductId,
        this.changeWhen,
      )
      .subscribe({
        next: () => {
          this.successMessage = 'Subscription plan updated.';
          this.actionInProgress = false;
          // Refresh details to reflect updated plan/status.
          this.selectSubscription({
            ...this.selectedSubscription!,
          });
        },
        error: () => {
          this.errorMessage = 'Failed to update subscription plan.';
          this.actionInProgress = false;
        },
      });
  }

  cancelSelected(): void {
    if (!this.selectedSubscription || !this.selectedSubscription.id) {
      return;
    }

    this.actionInProgress = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.subscriptionService
      .cancelSubscription(
        this.selectedSubscription.id,
        this.cancelWhen,
        this.cancelReason,
      )
      .subscribe({
        next: () => {
          this.successMessage = 'Subscription cancellation requested.';
          this.actionInProgress = false;
          this.loadSubscriptions();
        },
        error: () => {
          this.errorMessage = 'Failed to cancel subscription.';
          this.actionInProgress = false;
        },
      });
  }
}


