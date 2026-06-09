import type { Context } from 'hono';
import { fetchBalance } from '../lib/credits';
import type { Env } from '../types';

type AppContext = Context<{ Bindings: Env }>;

export async function getBalance(c: AppContext) {
  const tenant = c.get('tenant');
  const user = c.get('user');
  const token = c.req.header('Authorization')?.replace('Bearer ', '').trim() ?? '';

  const liveBalance = await fetchBalance(c.env, user.sub, token);
  const freshBalance = liveBalance ?? 0;

  // Fetch credit history from KKCredits
  let history: any[] = [];
  try {
    const histRes = await c.env.KKCREDITS.fetch(
      new Request(`https://kkcredits/history/${parseInt(user.sub, 10)}?limit=20`, {
        headers: { Authorization: `Bearer ${token}` }
      })
    );
    if (histRes.ok) {
      const histJson = await histRes.json<{ data: { rows: any[] } }>();
      history = histJson.data.rows;
    }
  } catch {
    // Non-fatal — return empty history if KKCredits is unavailable
  }

  const tenantConfig = tenant.config;

  return c.json({
    data: {
      balance: freshBalance,
      credits_name: tenantConfig.credits_name || 'KrowdKredits',
      history,
    },
  });
}

export async function getBalanceOnly(c: AppContext) {
  const user = c.get('user');
  const token = c.req.header('Authorization')?.replace('Bearer ', '').trim() ?? '';

  const liveBalance = await fetchBalance(c.env, user.sub, token);
  const balance = liveBalance ?? 0;

  return c.json({ data: { balance } });
}
