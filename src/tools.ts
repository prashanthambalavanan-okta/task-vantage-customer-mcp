import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { assertScope } from './auth.js';
import { customerStore } from './store.js';

const SCOPES = {
  read: 'customer:read',
  lookup: 'customer:lookup',
  history: 'customer:history',
  write: 'customer:write',
};

function json(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function scopeError(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

export function buildServer(): McpServer {
  const server = new McpServer({ name: 'task-vantage-customer', version: '0.1.0' });

  server.tool(
    'get_customer',
    'Get a customer account by ID.',
    { customerId: z.string().describe('Customer ID, e.g. "CUST-001"') },
    async ({ customerId }) => {
      const check = assertScope(SCOPES.read);
      if (!check.ok) return scopeError(check.message);
      const customer = customerStore.getCustomerById(customerId);
      if (!customer) return scopeError(`Customer not found: ${customerId}`);
      return json(customer);
    },
  );

  server.tool(
    'search_customers',
    'Search customers by name, contact, or location.',
    { query: z.string().describe('Search term, e.g. "Riverside" or "Columbus"') },
    async ({ query }) => {
      const check = assertScope(SCOPES.lookup);
      if (!check.ok) return scopeError(check.message);
      const results = customerStore.searchCustomers(query);
      return json({ query, count: results.length, results });
    },
  );

  server.tool(
    'get_customers_by_tier',
    'List customers in a given loyalty tier.',
    { tier: z.enum(['Platinum', 'Gold', 'Silver', 'Bronze']) },
    async ({ tier }) => {
      const check = assertScope(SCOPES.lookup);
      if (!check.ok) return scopeError(check.message);
      const results = customerStore.getCustomersByTier(tier);
      return json({ tier, count: results.length, results });
    },
  );

  server.tool(
    'get_top_customers',
    'List the highest lifetime-spend customers, optionally limited to a count.',
    { limit: z.number().int().positive().max(34).default(10) },
    async ({ limit }) => {
      const check = assertScope(SCOPES.history);
      if (!check.ok) return scopeError(check.message);
      const top = [...customerStore.getAllCustomers()]
        .sort((a, b) => b.total_spent - a.total_spent)
        .slice(0, limit);
      return json({ count: top.length, customers: top });
    },
  );

  server.tool(
    'get_customer_summary',
    'Get an aggregate customer summary by tier (account counts and total spend).',
    {},
    async () => {
      const check = assertScope(SCOPES.history);
      if (!check.ok) return scopeError(check.message);
      return json(customerStore.getCustomerSummary());
    },
  );

  server.tool(
    'add_customer',
    'Add a new customer account.',
    {
      name: z.string().describe('Customer or company name'),
      contact: z.string().describe('Primary contact name'),
      email: z.string().describe('Contact email'),
      tier: z.enum(['Platinum', 'Gold', 'Silver', 'Bronze']),
      location: z.string().describe('City, state'),
      total_spent: z.number().nonnegative().default(0),
    },
    async (input) => {
      const check = assertScope(SCOPES.write);
      if (!check.ok) return scopeError(check.message);
      return json(customerStore.addCustomer(input));
    },
  );

  server.tool(
    'delete_customer',
    'Remove a customer account.',
    { customerId: z.string().describe('Customer ID, e.g. "CUST-001"') },
    async ({ customerId }) => {
      const check = assertScope(SCOPES.write);
      if (!check.ok) return scopeError(check.message);
      const result = customerStore.deleteCustomer(customerId);
      if ('error' in result) return scopeError(result.error);
      return json(result);
    },
  );

  return server;
}
