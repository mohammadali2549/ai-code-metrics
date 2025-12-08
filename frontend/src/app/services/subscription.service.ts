import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface SubscriptionSummary {
  id: number;
  customerName: string;
  customerEmail: string;
  plan: string;
  status: string;
  nextBillingDate: string | null;
  monthlyAmount: number;
  monthlyAmountCents: number;
}

@Injectable({
  providedIn: 'root',
})
export class SubscriptionService {
  private apiUrl = 'http://localhost:3000/subscriptions';

  constructor(private http: HttpClient) {}

  getSubscriptions(
    status?: string,
    search?: string,
  ): Observable<SubscriptionSummary[]> {
    let params = new HttpParams();

    if (status) {
      params = params.set('status', status);
    }
    if (search) {
      params = params.set('q', search);
    }

    return this.http.get<SubscriptionSummary[]>(this.apiUrl, { params });
  }

  changePlan(
    id: number,
    newProductId: number,
    when: 'immediate' | 'delayed',
  ): Observable<unknown> {
    return this.http.post(`${this.apiUrl}/${id}/change-plan`, {
      newProductId,
      when,
    });
  }

  cancel(
    id: number,
    when: 'immediate' | 'delayed',
    reason?: string,
  ): Observable<unknown> {
    return this.http.post(`${this.apiUrl}/${id}/cancel`, {
      when,
      reason,
    });
  }
}


