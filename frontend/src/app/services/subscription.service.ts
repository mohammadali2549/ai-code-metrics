import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Subscription } from '../models/subscription.model';

@Injectable({
  providedIn: 'root',
})
export class SubscriptionService {
  private apiUrl = 'http://localhost:3000/subscriptions';

  constructor(private http: HttpClient) {}

  getSubscriptions(status?: string, search?: string): Observable<Subscription[]> {
    const params: { [key: string]: string } = {};
    if (status && status !== 'all') {
      params['status'] = status;
    }
    if (search) {
      params['search'] = search;
    }
    return this.http.get<Subscription[]>(this.apiUrl, { params });
  }
}


