import { Component, OnInit } from '@angular/core';
import { Subscription } from '../models/subscription.model';
import { SubscriptionService } from '../services/subscription.service';

@Component({
  selector: 'app-subscriptions',
  templateUrl: './subscriptions.component.html',
  styleUrls: ['./subscriptions.component.css'],
})
export class SubscriptionsComponent implements OnInit {
  subscriptions: Subscription[] = [];
  isLoading = false;
  errorMessage = '';

  constructor(private subscriptionService: SubscriptionService) {}

  ngOnInit(): void {
    this.loadSubscriptions();
  }

  loadSubscriptions(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.subscriptionService.getSubscriptions().subscribe({
      next: (data) => {
        this.subscriptions = data || [];
        this.isLoading = false;
      },
      error: () => {
        this.errorMessage = 'Failed to load subscriptions.';
        this.isLoading = false;
      },
    });
  }
}
