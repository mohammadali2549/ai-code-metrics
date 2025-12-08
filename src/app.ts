import * as dotenv from 'dotenv';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

// Load environment variables from .env file if available
dotenv.config();

// Retrieve environment variables from .env or GitHub Actions environment
const MAXIO_SITE = process.env.MAXIO_SITE;
const MAXIO_BASIC_AUTH_USERNAME = process.env.MAXIO_BASIC_AUTH_USERNAME;
const MAXIO_BASIC_AUTH_PASSWORD = process.env.MAXIO_BASIC_AUTH_PASSWORD;

// Validate required environment variables
if (!MAXIO_SITE || !MAXIO_BASIC_AUTH_USERNAME || !MAXIO_BASIC_AUTH_PASSWORD) {
  throw new Error('Missing required environment variables: MAXIO_SITE, MAXIO_BASIC_AUTH_USERNAME, or MAXIO_BASIC_AUTH_PASSWORD');
}

// Base URL for Maxio API
const MAXIO_API_BASE_URL = `https://${MAXIO_SITE}.chargify.com`;

// Create basic auth header
const authHeader = Buffer.from(`${MAXIO_BASIC_AUTH_USERNAME}:${MAXIO_BASIC_AUTH_PASSWORD}`).toString('base64');

// Type definitions for test compatibility
export type UiSubscriptionStatusFilter = 'active' | 'canceled' | 'past_due' | 'trialing';
export type ChangeSubscriptionWhen = 'immediately' | 'next_billing';
export type CancelSubscriptionWhen = 'immediately' | 'at_period_end';

/**
 * Helper function to make HTTP requests to Maxio API
 */
async function makeMaxioRequest(
  method: string,
  endpoint: string,
  body?: any
): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${MAXIO_API_BASE_URL}${endpoint}`);
    
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Authorization': `Basic ${authHeader}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            const parsedData = data ? JSON.parse(data) : {};
            resolve(parsedData);
          } else {
            reject(new Error(`Maxio API error: ${res.statusCode} - ${data}`));
          }
        } catch (error) {
          reject(new Error(`Failed to parse response: ${error}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

/**
 * View All Subscriptions
 * List of customers with their subscription status
 * 
 * @param statusFilter - Filter by: 'active', 'canceled', 'past_due', 'trialing'
 * @param searchQuery - Search by customer name or email
 * @returns Array of subscriptions with customer name, plan, status, next billing date, monthly amount
 */
export async function viewAllSubscriptions(
  statusFilter?: UiSubscriptionStatusFilter,
  searchQuery?: string
): Promise<any[]> {
  try {
    let endpoint = '/subscriptions.json';
    const params: string[] = [];

    if (statusFilter) {
      params.push(`state=${statusFilter}`);
    }

    if (searchQuery) {
      params.push(`q=${encodeURIComponent(searchQuery)}`);
    }

    if (params.length > 0) {
      endpoint += `?${params.join('&')}`;
    }

    const response = await makeMaxioRequest('GET', endpoint);
    
    // Transform response to include required fields
    // Maxio API returns { subscriptions: [...] } or array directly
    let subscriptions: any[] = [];
    if (Array.isArray(response)) {
      subscriptions = response;
    } else if (response && Array.isArray(response.subscriptions)) {
      subscriptions = response.subscriptions;
    } else if (response && response.subscription) {
      // Single subscription wrapped
      subscriptions = [response.subscription];
    }
    
    return subscriptions.map((sub: any) => {
      // Handle both direct subscription object and wrapped subscription
      const subscription = sub.subscription || sub;
      return {
        id: subscription.id,
        customerName: subscription.customer?.first_name && subscription.customer?.last_name 
          ? `${subscription.customer.first_name} ${subscription.customer.last_name}` 
          : subscription.customer?.first_name || subscription.customer?.last_name || 'N/A',
        customerEmail: subscription.customer?.email || 'N/A',
        plan: subscription.product?.name || subscription.product?.handle || 'N/A',
        status: subscription.state || 'unknown',
        nextBillingDate: subscription.next_assessment_at || subscription.current_period_ends_at || 'N/A',
        monthlyAmountCents: subscription.product?.price_in_cents || 0,
        subscription: subscription, // Include full subscription object for reference
      };
    });
  } catch (error) {
    console.error('Error fetching subscriptions:', error);
    throw error;
  }
}

/**
 * View Single Subscription Details
 * Show detailed information for a specific subscription
 * 
 * @param subscriptionId - The subscription ID
 * @returns Subscription details including customer info, plan, status, billing cycle, payment method
 */
export async function viewSubscriptionDetails(subscriptionId: string | number): Promise<any> {
  try {
    const response = await makeMaxioRequest('GET', `/subscriptions/${subscriptionId}.json`);
    const subscription = response.subscription || response;

    return {
      subscriptionId: subscription.id,
      customer: {
        name: subscription.customer?.first_name && subscription.customer?.last_name
          ? `${subscription.customer.first_name} ${subscription.customer.last_name}`
          : subscription.customer?.first_name || subscription.customer?.last_name || 'N/A',
        email: subscription.customer?.email || 'N/A',
        customerId: subscription.customer?.id || 'N/A',
      },
      plan: {
        name: subscription.product?.name || 'N/A',
        handle: subscription.product?.handle || 'N/A',
        price: subscription.product?.price_in_cents ? (subscription.product.price_in_cents / 100) : 0,
        priceInCents: subscription.product?.price_in_cents || 0,
      },
      status: subscription.state || 'unknown',
      billingCycle: {
        interval: subscription.product?.interval || 'N/A',
        intervalUnit: subscription.product?.interval_unit || 'N/A',
        currentPeriodStart: subscription.current_period_start_at || 'N/A',
        currentPeriodEnd: subscription.current_period_ends_at || 'N/A',
        nextBillingDate: subscription.next_assessment_at || subscription.current_period_ends_at || 'N/A',
      },
      paymentMethod: {
        type: subscription.payment_collection_method || 'N/A',
        cardType: subscription.credit_card?.card_type || 'N/A',
        lastFour: subscription.credit_card?.last_four || 'N/A',
        expirationMonth: subscription.credit_card?.expiration_month || 'N/A',
        expirationYear: subscription.credit_card?.expiration_year || 'N/A',
        billingAddress: subscription.billing_address || 'N/A',
      },
      fullSubscription: subscription, // Include full subscription object for reference
    };
  } catch (error) {
    console.error(`Error fetching subscription ${subscriptionId}:`, error);
    throw error;
  }
}

/**
 * Get Subscription Details (alias for test compatibility)
 * Show detailed information for a specific subscription
 * 
 * @param subscriptionId - The subscription ID
 * @returns Subscription details with test-expected structure
 */
export async function getSubscriptionDetails(subscriptionId: number): Promise<any> {
  try {
    const response = await makeMaxioRequest('GET', `/subscriptions/${subscriptionId}.json`);
    const subscription = response.subscription || response;

    return {
      id: subscription.id,
      customerInfo: {
        name: subscription.customer?.first_name && subscription.customer?.last_name
          ? `${subscription.customer.first_name} ${subscription.customer.last_name}`
          : subscription.customer?.first_name || subscription.customer?.last_name || 'N/A',
        email: subscription.customer?.email || 'N/A',
      },
      currentPlan: subscription.product?.name || subscription.product?.handle || 'N/A',
      currentPriceCents: subscription.product?.price_in_cents || 0,
      billingCycle: {
        currentPeriodStartedAt: subscription.current_period_start_at || 'N/A',
        currentPeriodEndsAt: subscription.current_period_ends_at || 'N/A',
      },
      nextBillingDate: subscription.next_assessment_at || subscription.current_period_ends_at || 'N/A',
      paymentMethod: {
        type: subscription.payment_collection_method || 'N/A',
        cardType: subscription.credit_card?.card_type || 'N/A',
        lastFour: subscription.credit_card?.last_four || 'N/A',
      },
    };
  } catch (error) {
    console.error(`Error fetching subscription ${subscriptionId}:`, error);
    throw error;
  }
}

/**
 * Change Subscription Plan
 * Upgrade or downgrade customer to a different plan
 * 
 * @param subscriptionId - The subscription ID
 * @param productId - The ID of the new product/plan
 * @param when - 'immediately' or 'next_billing' - when the change takes effect
 * @returns Updated subscription information
 */
export async function changeSubscriptionPlan(
  subscriptionId: number,
  productId: number,
  when: ChangeSubscriptionWhen
): Promise<any> {
  try {
    // First, get the current subscription to check product details
    const currentSubscription = await getSubscriptionDetails(subscriptionId);
    
    // Get product details to get the handle
    const productResponse = await makeMaxioRequest('GET', `/products/${productId}.json`);
    const product = productResponse.product || productResponse;
    const productHandle = product.handle;

    if (!productHandle) {
      throw new Error(`Product with ID ${productId} not found or invalid`);
    }
    
    // Prepare migration payload
    const migrationPayload: any = {
      product_handle: productHandle,
      include_trial: false,
    };

    if (when === 'immediately') {
      // Change immediately - include initial charge and proration
      migrationPayload.include_initial_charge = true;
      migrationPayload.preserve_period = false;
    } else {
      // Change at next billing cycle
      migrationPayload.include_initial_charge = false;
      migrationPayload.preserve_period = true;
    }

    // Maxio API endpoint for subscription migration
    const response = await makeMaxioRequest(
      'POST',
      `/subscriptions/${subscriptionId}/migrations.json`,
      {
        migration: migrationPayload,
      }
    );

    return {
      success: true,
      subscription: response.subscription || response,
      message: `Subscription plan changed to ${productHandle}. Change takes effect ${when === 'immediately' ? 'immediately' : 'at next billing cycle'}.`,
    };
  } catch (error) {
    console.error(`Error changing plan for subscription ${subscriptionId}:`, error);
    throw error;
  }
}

/**
 * Cancel Subscription
 * Cancel a customer's subscription
 * 
 * @param subscriptionId - The subscription ID
 * @param cancelTiming - 'immediate' or 'at_period_end' - when to cancel
 * @param cancellationReason - Optional cancellation reason/note
 * @returns Cancellation confirmation
 */
export async function cancelSubscription(
  subscriptionId: string | number,
  cancelTiming: 'immediate' | 'at_period_end',
  cancellationReason?: string
): Promise<any> {
  try {
    const cancelPayload: any = {
      subscription: {
        cancellation_message: cancellationReason || 'Subscription cancelled by admin',
      },
    };

    if (cancelTiming === 'immediate') {
      cancelPayload.subscription.cancel_at_end_of_period = false;
    } else {
      cancelPayload.subscription.cancel_at_end_of_period = true;
    }

    // Maxio API endpoint for subscription cancellation (using PUT to update subscription)
    const response = await makeMaxioRequest(
      'PUT',
      `/subscriptions/${subscriptionId}.json`,
      cancelPayload
    );

    return {
      success: true,
      subscription: response.subscription || response,
      message: `Subscription cancelled ${cancelTiming === 'immediate' ? 'immediately' : 'at period end'}.`,
      cancellationReason: cancellationReason || 'N/A',
    };
  } catch (error) {
    console.error(`Error canceling subscription ${subscriptionId}:`, error);
    throw error;
  }
}

/**
 * Cancel Subscription Core (alias for test compatibility)
 * Cancel a customer's subscription
 * 
 * @param subscriptionId - The subscription ID
 * @param when - 'immediately' or 'at_period_end' - when to cancel
 * @param cancellationReason - Optional cancellation reason/note
 * @returns Cancellation confirmation
 */
export async function cancelSubscriptionCore(
  subscriptionId: number,
  when: CancelSubscriptionWhen,
  cancellationReason?: string
): Promise<any> {
  const cancelTiming = when === 'immediately' ? 'immediate' : 'at_period_end';
  return cancelSubscription(subscriptionId, cancelTiming, cancellationReason);
}

// Create a simple HTTP server for test compatibility
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Maxio Subscription Service');
});

// Start server on a random port (for test compatibility)
server.listen(0, () => {
  // Server started, tests can close it
});

export { server };

