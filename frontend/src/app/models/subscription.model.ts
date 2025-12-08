export interface Subscription {
  id: number | string | null;
  customerName: string | null;
  customerEmail: string | null;
  plan: string | null;
  status: string | null;
  nextBillingDate: string | null;
  monthlyAmount: number | null;
  monthlyAmountCents?: number | null;
}


