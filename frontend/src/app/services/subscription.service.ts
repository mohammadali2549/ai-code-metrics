import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export type UiSubscriptionStatusFilter = 'all' | 'active' | 'canceled' | 'past_due' | 'trialing';

export interface SubscriptionListItem {
  id: number | string | undefined;
  customerName: string;
  customerEmail?: string;
  plan?: string;
  status?: string;
  nextBillingDate?: string | null;
  monthlyAmountInCents?: number | null;
}

export interface SubscriptionDetails {
  id: number | string | undefined;
  customerName: string;
  customerEmail?: string;
  customerInfo: {
    name: string;
    email?: string;
  };
  currentPlan?: string;
  currentPriceCents?: number | null;
  status?: string;
  billingCycle?: {
    currentPeriodStartedAt?: string | null;
    currentPeriodEndsAt?: string | null;
    nextBillingAt?: string | null;
  };
  nextBillingDate?: string | null;
  paymentMethod?: string | null;
}

export type ChangeSubscriptionWhen = 'immediately' | 'next_billing';
export type CancelSubscriptionWhen = 'immediately' | 'period_end';

@Injectable({
  providedIn: 'root',
})
export class SubscriptionService {
  private readonly baseUrl = 'http://localhost:3000/subscriptions';

  constructor(private http: HttpClient) {}

  getSubscriptions(
    status: UiSubscriptionStatusFilter,
    search: string,
  ): Observable<SubscriptionListItem[]> {
    let params = new HttpParams();

    if (status && status !== 'all') {
      params = params.set('status', status);
    }

    if (search && search.trim().length > 0) {
      params = params.set('search', search.trim());
    }

    return this.http.get<SubscriptionListItem[]>(this.baseUrl, { params });
  }

  getSubscriptionDetails(id: number | string): Observable<SubscriptionDetails> {
    return this.http.get<SubscriptionDetails>(`${this.baseUrl}/${id}`);
  }

  changeSubscriptionPlan(
    id: number | string,
    targetProductId: number,
    when: ChangeSubscriptionWhen,
  ): Observable<unknown> {
    const immediate = when === 'immediately';
    return this.http.post(`${this.baseUrl}/${id}/change-plan`, {
      targetProductId,
      immediate,
    });
  }

  cancelSubscription(
    id: number | string,
    when: CancelSubscriptionWhen,
    reason: string,
  ): Observable<unknown> {
    const immediate = when === 'immediately';
    return this.http.post(`${this.baseUrl}/${id}/cancel`, {
      immediate,
      cancellationReason: reason,
    });
  }
}


