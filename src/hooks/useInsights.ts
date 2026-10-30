import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

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
  return useMemo(() => generateInsights(s), [s]);
}
