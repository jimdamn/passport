import type { Context } from 'hono';
import { fetchBalance } from '../lib/credits';
import type { Env } from '../types';

type AppContext = Context<{ Bindings: Env }>;

// GET /api/t/:tenant/credits/balance — balance + history for StatsPanel/MyProfile.
// Passport's users table has no credits_balance cache column, so KKCredits is
// queried directly; on outage we return 0 rather than failing the whole panel.
export async function getBalance(c: AppContext) {
  const tenant = c.get('tenant');
  const user = c.get('user');
  const token = c.req.header('Authorization')?.replace('Bearer ', '').trim() ?? '';

  const balance = (await fetchBalance(c.env, user.sub, token)) ?? 0;

  let history: any[] = [];
  try {
    const histRes = await c.env.KKCREDITS.fetch(
      new Request(`https://kkcredits/history/${parseInt(user.sub, 10)}?limit=20`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    );
    if (histRes.ok) {
      const histJson = await histRes.json<{ data: { rows: any[] } }>();
      history = histJson.data.rows;
    }
  } catch {
    // Non-fatal — return empty history if KKCredits is unavailable
  }

  return c.json({
    data: {
      balance,
      credits_name: tenant.config.credits_name || 'KrowdKredits',
      history,
    },
  });
}

// GET /api/t/:tenant/credits/balance-only — number only, used by the Topbar badge.
export async function getBalanceOnly(c: AppContext) {
  const user = c.get('user');
  const token = c.req.header('Authorization')?.replace('Bearer ', '').trim() ?? '';

  const balance = (await fetchBalance(c.env, user.sub, token)) ?? 0;

  return c.json({ data: { balance } });
}
