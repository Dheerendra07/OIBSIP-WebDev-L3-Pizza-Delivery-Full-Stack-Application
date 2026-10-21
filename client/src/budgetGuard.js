export function evaluateBudget(total, budgetInput) {
  const amount = Number(total);
  const configured = budgetInput !== null && budgetInput !== undefined && String(budgetInput).trim() !== '';

  if (!Number.isFinite(amount) || amount < 0) {
    return { configured, valid: false, withinBudget: false, remaining: null, overBy: null };
  }

  if (!configured) {
    return { configured: false, valid: true, withinBudget: true, remaining: null, overBy: 0, limit: null };
  }

  const limit = Number(budgetInput);
  if (!Number.isSafeInteger(limit) || limit < 1) {
    return { configured: true, valid: false, withinBudget: false, remaining: null, overBy: null, limit: null };
  }

  const difference = limit - amount;
  return {
    configured: true,
    valid: true,
    withinBudget: difference >= 0,
    remaining: Math.max(0, difference),
    overBy: Math.max(0, -difference),
    limit,
  };
}
