import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { today } from '@/lib/dates';
import { generateInsights } from '@/lib/insights';
import { useStore } from '@/store/useStore';

export function useInsights() {
  const s = useStore(
    useShallow((st) => ({
      bills: st.bills,
      transactions: st.transactions,
      goals: st.goals,
      plan: st.plan,
      income: st.income,
      weeklyFoodBudget: st.weeklyFoodBudget,
      householdSize: st.profile.householdSize,
      currency: st.profile.currency,
      dismissed: st.dismissedInsights,
      assignedWeeks: st.assignedWeeks,
    })),
  );
  // The clock is read here, in the hook, and passed into the pure engine
  const asOf = today();
  const hasFinancialData = !!s.income || s.bills.length > 0 || s.transactions.length > 0 || s.weeklyFoodBudget > 0;
  return useMemo(() => (hasFinancialData ? generateInsights({ ...s, asOf }) : []), [s, asOf, hasFinancialData]);
}
