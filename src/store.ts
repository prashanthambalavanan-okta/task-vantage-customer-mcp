import seed from './data/customers.json' with { type: 'json' };
import type { Customer, CustomerSummary, SeedData } from './types.js';

const initialData = seed as unknown as SeedData;

/**
 * In-memory data store seeded from the ported ProGear demo dataset.
 * State resets on process restart — this is a tools/data server, not a
 * system of record.
 */
class CustomerStore {
  private customers: Record<string, Customer>;
  private customerSeq: number;

  constructor() {
    this.customers = { ...initialData.customers };

    this.customerSeq = Object.keys(this.customers).reduce((max, id) => {
      const match = /^CUST-(\d+)$/.exec(id);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
  }

  private nextCustomerId(): string {
    this.customerSeq += 1;
    return `CUST-${String(this.customerSeq).padStart(3, '0')}`;
  }

  getAllCustomers(): Customer[] {
    return Object.values(this.customers);
  }

  getCustomerById(id: string): Customer | undefined {
    return this.customers[id];
  }

  getCustomersByTier(tier: string): Customer[] {
    const lower = tier.toLowerCase();
    return this.getAllCustomers().filter((c) => c.tier.toLowerCase() === lower);
  }

  searchCustomers(query: string): Customer[] {
    const queryLower = query.toLowerCase();
    return this.getAllCustomers().filter(
      (c) =>
        c.name.toLowerCase().includes(queryLower) ||
        c.contact.toLowerCase().includes(queryLower) ||
        c.location.toLowerCase().includes(queryLower),
    );
  }

  addCustomer(input: {
    name: string;
    contact: string;
    email: string;
    tier: Customer['tier'];
    location: string;
    total_spent?: number;
  }): Customer {
    const customer: Customer = {
      id: this.nextCustomerId(),
      name: input.name,
      contact: input.contact,
      email: input.email,
      tier: input.tier,
      location: input.location,
      total_spent: input.total_spent ?? 0,
    };
    this.customers[customer.id] = customer;
    return customer;
  }

  deleteCustomer(id: string): { ok: true } | { error: string } {
    if (!this.customers[id]) return { error: `Customer not found: ${id}` };
    delete this.customers[id];
    return { ok: true };
  }

  getCustomerSummary(): CustomerSummary {
    const byTier: CustomerSummary['by_tier'] = {};
    let totalSpent = 0;

    for (const customer of this.getAllCustomers()) {
      const tier = byTier[customer.tier] ?? { count: 0, total_spent: 0 };
      tier.count += 1;
      tier.total_spent += customer.total_spent;
      byTier[customer.tier] = tier;
      totalSpent += customer.total_spent;
    }

    return {
      total_customers: this.getAllCustomers().length,
      total_revenue: totalSpent,
      by_tier: byTier,
    };
  }
}

export const customerStore = new CustomerStore();
export { CustomerStore };
