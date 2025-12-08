import { Component } from '@angular/core';
import { SubscriptionService, SubscriptionSummary } from './services/subscription.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent {
  selectedItemId: number | null = null;
  showSubscriptions = false;
  subscriptions: SubscriptionSummary[] = [];
  loadingSubscriptions = false;
  subscriptionsError: string | null = null;

  onItemSelected(itemId: number): void {
    this.selectedItemId = itemId;
  }

  constructor(private readonly subscriptionService: SubscriptionService) {}

  openSubscriptions(): void {
    this.showSubscriptions = true;
    this.loadSubscriptions();
  }

  closeSubscriptions(): void {
    this.showSubscriptions = false;
  }

  loadSubscriptions(status?: string, search?: string): void {
    this.loadingSubscriptions = true;
    this.subscriptionsError = null;

    this.subscriptionService.getSubscriptions(status, search).subscribe({
      next: (subs) => {
        this.subscriptions = subs;
        this.loadingSubscriptions = false;
      },
      error: (err) => {
        console.error('Failed to load subscriptions', err);
        this.subscriptionsError = 'Failed to load subscriptions. Please try again.';
        this.loadingSubscriptions = false;
      },
    });
  }

  onFilterChange(status: string, search: string): void {
    this.loadSubscriptions(status || undefined, search || undefined);
  }

  promptChangePlan(sub: SubscriptionSummary): void {
    const newProductIdRaw = window.prompt(
      `Enter new product/plan ID for ${sub.customerName} (current: ${sub.plan}):`,
    );
    if (!newProductIdRaw) {
      return;
    }

    const newProductId = Number(newProductIdRaw);
    if (!Number.isFinite(newProductId) || newProductId <= 0) {
      alert('Please enter a valid numeric product ID.');
      return;
    }

    const whenRaw = window.prompt(
      'When should the change take effect? Type "immediate" or "delayed":',
      'immediate',
    );
    const when = (whenRaw || '').toLowerCase() as 'immediate' | 'delayed';
    if (when !== 'immediate' && when !== 'delayed') {
      alert('Timing must be "immediate" or "delayed".');
      return;
    }

    this.subscriptionService.changePlan(sub.id, newProductId, when).subscribe({
      next: () => {
        alert('Subscription plan change requested successfully.');
        this.loadSubscriptions();
      },
      error: (err) => {
        console.error('Failed to change subscription plan', err);
        alert('Failed to change subscription plan. Please check the console/logs.');
      },
    });
  }

  promptCancel(sub: SubscriptionSummary): void {
    const whenRaw = window.prompt(
      `Cancel subscription for ${sub.customerName} now or at period end? Type "immediate" or "delayed":`,
      'immediate',
    );
    const when = (whenRaw || '').toLowerCase() as 'immediate' | 'delayed';
    if (when !== 'immediate' && when !== 'delayed') {
      alert('Timing must be "immediate" or "delayed".');
      return;
    }

    const reason =
      window.prompt('Optional: add a cancellation reason/note:', '') || undefined;

    this.subscriptionService.cancel(sub.id, when, reason).subscribe({
      next: () => {
        alert('Subscription cancelled successfully.');
        this.loadSubscriptions();
      },
      error: (err) => {
        console.error('Failed to cancel subscription', err);
        alert('Failed to cancel subscription. Please check the console/logs.');
      },
    });
  }
}

