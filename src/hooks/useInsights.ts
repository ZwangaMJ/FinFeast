import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { generateInsights } from '@/lib/insights';
import { useStore } from '@/store/useStore';

export function useInsights() {
  const s = useStore(
    useShallow((st) => ({
      recurringExpenses: st.recurringExpenses,
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
  const hasFinancialData = !!s.income || s.recurringExpenses.length > 0 || s.transactions.length > 0 || s.weeklyFoodBudget > 0;
  return useMemo(() => hasFinancialData ? generateInsights(s) : [], [s, hasFinancialData]);
}
