export interface Customer {
  id: string;
  name: string;
  contact: string;
  email: string;
  tier: 'Platinum' | 'Gold' | 'Silver' | 'Bronze';
  total_spent: number;
  location: string;
}

export interface CustomerSummary {
  total_customers: number;
  total_revenue: number;
  by_tier: Record<string, { count: number; total_spent: number }>;
}

export interface SeedData {
  customers: Record<string, Customer>;
}
