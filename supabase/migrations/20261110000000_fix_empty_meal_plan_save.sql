create or replace function public.replace_user_data(p_data jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication is required to save FinFeast data';
  end if;

  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'FinFeast data must be a JSON object';
  end if;

  insert into public.user_profiles (
    user_id, name, household_size, currency, diet, allergies, calorie_target,
    max_cook_minutes, goal_priority, theme_mode, notifications, risk_alerts,
    weekly_digest, onboarded, manual_mode
  )
  values (
    current_user_id,
    coalesce(p_data #>> '{profile,name}', ''),
    coalesce((p_data #>> '{profile,householdSize}')::integer, 2),
    coalesce(p_data #>> '{profile,currency}', 'ZAR'),
    coalesce(p_data #>> '{profile,diet}', 'omnivore'),
    array(select jsonb_array_elements_text(coalesce(p_data #> '{profile,allergies}', '[]'::jsonb))),
    coalesce((p_data #>> '{profile,calorieTarget}')::integer, 2000),
    coalesce((p_data #>> '{profile,maxCookMinutes}')::integer, 45),
    coalesce(p_data #>> '{profile,goalPriority}', 'safety'),
    coalesce(p_data #>> '{settings,themeMode}', 'system'),
    coalesce((p_data #>> '{settings,notifications}')::boolean, false),
    coalesce((p_data #>> '{settings,riskAlerts}')::boolean, true),
    coalesce((p_data #>> '{settings,weeklyDigest}')::boolean, true),
    coalesce((p_data ->> 'onboarded')::boolean, false),
    coalesce((p_data ->> 'manualMode')::boolean, false)
  )
  on conflict (user_id) do update set
    name = excluded.name,
    household_size = excluded.household_size,
    currency = excluded.currency,
    diet = excluded.diet,
    allergies = excluded.allergies,
    calorie_target = excluded.calorie_target,
    max_cook_minutes = excluded.max_cook_minutes,
    goal_priority = excluded.goal_priority,
    theme_mode = excluded.theme_mode,
    notifications = excluded.notifications,
    risk_alerts = excluded.risk_alerts,
    weekly_digest = excluded.weekly_digest,
    onboarded = excluded.onboarded,
    manual_mode = excluded.manual_mode;

  insert into public.user_finances (user_id, weekly_food_budget, tax_info, last_month_processed, last_payday_processed)
  values (
    current_user_id,
    coalesce((p_data ->> 'weeklyFoodBudget')::numeric, 700),
    p_data -> 'taxInfo',
    nullif(p_data ->> 'lastMonthProcessed', '')::date,
    nullif(p_data ->> 'lastPaydayProcessed', '')::date
  )
  on conflict (user_id) do update set
    weekly_food_budget = excluded.weekly_food_budget,
    tax_info = excluded.tax_info,
    last_month_processed = excluded.last_month_processed,
    last_payday_processed = excluded.last_payday_processed;

  if p_data -> 'income' is null or p_data -> 'income' = 'null'::jsonb then
    delete from public.user_income where user_id = current_user_id;
  else
    insert into public.user_income (user_id, net, gross, frequency, employer, payday, source)
    select current_user_id, income.net, income.gross, income.frequency, income.employer, income.payday, income.source
    from jsonb_to_record(p_data -> 'income') as income(
      net numeric, gross numeric, frequency text, employer text, payday integer, source text
    )
    on conflict (user_id) do update set
      net = excluded.net,
      gross = excluded.gross,
      frequency = excluded.frequency,
      employer = excluded.employer,
      payday = excluded.payday,
      source = excluded.source;
  end if;

  insert into public.user_app_state (user_id, tried_recipes, grocery_checked, dismissed_insights, assigned_weeks)
  values (
    current_user_id,
    array(select jsonb_array_elements_text(coalesce(p_data -> 'tried', '[]'::jsonb))),
    array(select jsonb_array_elements_text(coalesce(p_data -> 'groceryChecked', '[]'::jsonb))),
    array(select jsonb_array_elements_text(coalesce(p_data -> 'dismissedInsights', '[]'::jsonb))),
    array(select jsonb_array_elements_text(coalesce(p_data -> 'assignedWeeks', '[]'::jsonb)))::date[]
  )
  on conflict (user_id) do update set
    tried_recipes = excluded.tried_recipes,
    grocery_checked = excluded.grocery_checked,
    dismissed_insights = excluded.dismissed_insights,
    assigned_weeks = excluded.assigned_weeks;

  insert into public.bills (user_id, id, name, amount, day, cadence, confidence, active, is_subscription, usage_note, months_paid)
  select current_user_id, item.id, item.name, item.amount, item.day, item.cadence, item.confidence,
         coalesce(item.active, true), coalesce(item."isSubscription", false), item."usageNote", item."monthsPaid"
  from jsonb_to_recordset(coalesce(p_data -> 'bills', '[]'::jsonb)) as item(
    id text, name text, amount numeric, day integer, cadence text, confidence text,
    active boolean, "isSubscription" boolean, "usageNote" text, "monthsPaid" integer
  )
  on conflict (user_id, id) do update set
    name = excluded.name, amount = excluded.amount, day = excluded.day, cadence = excluded.cadence,
    confidence = excluded.confidence, active = excluded.active, is_subscription = excluded.is_subscription,
    usage_note = excluded.usage_note, months_paid = excluded.months_paid;

  delete from public.bills existing
  where existing.user_id = current_user_id
    and not exists (
      select 1 from jsonb_to_recordset(coalesce(p_data -> 'bills', '[]'::jsonb)) as item(id text)
      where item.id = existing.id
    );

  insert into public.documents (user_id, id, name, type, hash, added_at, status, pages, summary)
  select current_user_id, item.id, item.name, item.type, item.hash, item."addedAt", item.status, item.pages, item.summary
  from jsonb_to_recordset(coalesce(p_data -> 'documents', '[]'::jsonb)) as item(
    id text, name text, type text, hash text, "addedAt" timestamptz, status text, pages integer, summary text
  )
  on conflict (user_id, id) do update set
    name = excluded.name, type = excluded.type, hash = excluded.hash, added_at = excluded.added_at,
    status = excluded.status, pages = excluded.pages, summary = excluded.summary;

  insert into public.transactions (
    user_id, id, transaction_date, merchant, amount, kind, category, confidence,
    question, alternatives, source_document_id, line_items
  )
  select current_user_id, item.id, item.date, item.merchant, item.amount, item.kind,
         item.category, item.confidence, item.question,
         array(select jsonb_array_elements_text(coalesce(item.alternatives, '[]'::jsonb))),
         document.id, item."lineItems"
  from jsonb_to_recordset(coalesce(p_data -> 'transactions', '[]'::jsonb)) as item(
    id text, date date, merchant text, amount numeric, kind text, category text, confidence text,
    question text, alternatives jsonb, "sourceDocId" text, "lineItems" jsonb
  )
  left join public.documents document
    on document.user_id = current_user_id and document.id = item."sourceDocId"
  on conflict (user_id, id) do update set
    transaction_date = excluded.transaction_date, merchant = excluded.merchant, amount = excluded.amount,
    kind = excluded.kind, category = excluded.category, confidence = excluded.confidence,
    question = excluded.question, alternatives = excluded.alternatives,
    source_document_id = excluded.source_document_id, line_items = excluded.line_items;

  delete from public.transactions existing
  where existing.user_id = current_user_id
    and not exists (
      select 1 from jsonb_to_recordset(coalesce(p_data -> 'transactions', '[]'::jsonb)) as item(id text)
      where item.id = existing.id
    );

  delete from public.documents existing
  where existing.user_id = current_user_id
    and not exists (
      select 1 from jsonb_to_recordset(coalesce(p_data -> 'documents', '[]'::jsonb)) as item(id text)
      where item.id = existing.id
    );

  insert into public.meal_plans (user_id, week_start, is_pending, pending_reason, plan)
  select current_user_id, (item.plan ->> 'weekStart')::date, item.is_pending, item.pending_reason, item.plan
  from jsonb_to_recordset(
    (case when p_data -> 'plan' is null or p_data -> 'plan' = 'null'::jsonb
      then '[]'::jsonb
      else jsonb_build_array(jsonb_build_object('plan', p_data -> 'plan', 'is_pending', false))
    end)
    ||
    (case when p_data -> 'pendingPlan' is null or p_data -> 'pendingPlan' = 'null'::jsonb
      then '[]'::jsonb
      else jsonb_build_array(jsonb_build_object('plan', p_data -> 'pendingPlan', 'is_pending', true, 'pending_reason', p_data ->> 'pendingReason'))
    end)
  ) as item(plan jsonb, is_pending boolean, pending_reason text)
  where item.plan is not null
  on conflict (user_id, week_start, is_pending) do update set
    pending_reason = excluded.pending_reason, plan = excluded.plan;

  delete from public.meal_plans existing
  where existing.user_id = current_user_id
    and not exists (
      select 1
      from jsonb_to_recordset(
        (case when p_data -> 'plan' is null or p_data -> 'plan' = 'null'::jsonb
          then '[]'::jsonb
          else jsonb_build_array(jsonb_build_object('week_start', p_data #>> '{plan,weekStart}', 'is_pending', false))
        end)
        ||
        (case when p_data -> 'pendingPlan' is null or p_data -> 'pendingPlan' = 'null'::jsonb
          then '[]'::jsonb
          else jsonb_build_array(jsonb_build_object('week_start', p_data #>> '{pendingPlan,weekStart}', 'is_pending', true))
        end)
      ) as item(week_start date, is_pending boolean)
      where item.week_start = existing.week_start and item.is_pending = existing.is_pending
    );

  insert into public.pantry_items (user_id, item_key, added_at)
  select current_user_id, item.key, item."addedAt"
  from jsonb_to_recordset(coalesce(p_data -> 'pantry', '[]'::jsonb)) as item(key text, "addedAt" date)
  on conflict (user_id, item_key) do update set added_at = excluded.added_at;

  delete from public.pantry_items existing
  where existing.user_id = current_user_id
    and not exists (
      select 1 from jsonb_to_recordset(coalesce(p_data -> 'pantry', '[]'::jsonb)) as item(key text)
      where item.key = existing.item_key
    );

  insert into public.goals (user_id, id, type, name, target, current, deadline, monthly_committed, created_at)
  select current_user_id, item.id, item.type, item.name, item.target, item.current, item.deadline,
         item."monthlyCommitted", coalesce(item."createdAt", now())
  from jsonb_to_recordset(coalesce(p_data -> 'goals', '[]'::jsonb)) as item(
    id text, type text, name text, target numeric, current numeric, deadline date,
    "monthlyCommitted" numeric, "createdAt" timestamptz
  )
  on conflict (user_id, id) do update set
    type = excluded.type, name = excluded.name, target = excluded.target, current = excluded.current,
    deadline = excluded.deadline, monthly_committed = excluded.monthly_committed;

  insert into public.goal_rules (user_id, id, goal_id, kind, amount, percent, enabled)
  select current_user_id, rule.id, goal.id, rule.kind, rule.amount, rule.percent, rule.enabled
  from jsonb_to_recordset(coalesce(p_data -> 'goals', '[]'::jsonb)) as goal(id text, rules jsonb)
  cross join lateral jsonb_to_recordset(coalesce(goal.rules, '[]'::jsonb)) as rule(
    id text, kind text, amount numeric, percent numeric, enabled boolean
  )
  on conflict (user_id, id) do update set
    goal_id = excluded.goal_id, kind = excluded.kind, amount = excluded.amount,
    percent = excluded.percent, enabled = excluded.enabled;

  delete from public.goal_rules existing
  where existing.user_id = current_user_id
    and not exists (
      select 1
      from jsonb_to_recordset(coalesce(p_data -> 'goals', '[]'::jsonb)) as goal(id text, rules jsonb)
      cross join lateral jsonb_to_recordset(coalesce(goal.rules, '[]'::jsonb)) as rule(id text)
      where rule.id = existing.id
    );

  insert into public.goal_contributions (user_id, id, goal_id, contribution_date, amount, source)
  select current_user_id, contribution.id, goal.id, contribution.date, contribution.amount, contribution.source
  from jsonb_to_recordset(coalesce(p_data -> 'goals', '[]'::jsonb)) as goal(id text, contributions jsonb)
  cross join lateral jsonb_to_recordset(coalesce(goal.contributions, '[]'::jsonb)) as contribution(
    id text, date date, amount numeric, source text
  )
  on conflict (user_id, id) do update set
    goal_id = excluded.goal_id, contribution_date = excluded.contribution_date,
    amount = excluded.amount, source = excluded.source;

  delete from public.goal_contributions existing
  where existing.user_id = current_user_id
    and not exists (
      select 1
      from jsonb_to_recordset(coalesce(p_data -> 'goals', '[]'::jsonb)) as goal(id text, contributions jsonb)
      cross join lateral jsonb_to_recordset(coalesce(goal.contributions, '[]'::jsonb)) as contribution(id text)
      where contribution.id = existing.id
    );

  insert into public.found_money (user_id, id, amount, headline, source, kind, created_at, status, auto)
  select current_user_id, item.id, item.amount, item.headline, item.source, item.kind,
         coalesce(item."createdAt", now()), item.status, coalesce(item.auto, false)
  from jsonb_to_recordset(coalesce(p_data -> 'foundMoney', '[]'::jsonb)) as item(
    id text, amount numeric, headline text, source text, kind text, "createdAt" timestamptz,
    status text, auto boolean, allocations jsonb
  )
  on conflict (user_id, id) do update set
    amount = excluded.amount, headline = excluded.headline, source = excluded.source,
    kind = excluded.kind, created_at = excluded.created_at, status = excluded.status, auto = excluded.auto;

  insert into public.found_money_allocations (user_id, found_money_id, goal_id, amount)
  select current_user_id, money.id, allocation."goalId", allocation.amount
  from jsonb_to_recordset(coalesce(p_data -> 'foundMoney', '[]'::jsonb)) as money(id text, allocations jsonb)
  cross join lateral jsonb_to_recordset(coalesce(money.allocations, '[]'::jsonb)) as allocation("goalId" text, amount numeric)
  join public.goals goal
    on goal.user_id = current_user_id and goal.id = allocation."goalId"
  on conflict (user_id, found_money_id, goal_id) do update set amount = excluded.amount;

  delete from public.found_money_allocations existing
  where existing.user_id = current_user_id
    and not exists (
      select 1
      from jsonb_to_recordset(coalesce(p_data -> 'foundMoney', '[]'::jsonb)) as money(id text, allocations jsonb)
      cross join lateral jsonb_to_recordset(coalesce(money.allocations, '[]'::jsonb)) as allocation("goalId" text)
      where money.id = existing.found_money_id and allocation."goalId" = existing.goal_id
    );

  delete from public.found_money existing
  where existing.user_id = current_user_id
    and not exists (
      select 1 from jsonb_to_recordset(coalesce(p_data -> 'foundMoney', '[]'::jsonb)) as item(id text)
      where item.id = existing.id
    );

  delete from public.goals existing
  where existing.user_id = current_user_id
    and not exists (
      select 1 from jsonb_to_recordset(coalesce(p_data -> 'goals', '[]'::jsonb)) as item(id text)
      where item.id = existing.id
    );

  insert into public.week_history (user_id, week_start, estimate, actual)
  select current_user_id, item."weekStart", item.estimate, item.actual
  from jsonb_to_recordset(coalesce(p_data -> 'weekHistory', '[]'::jsonb)) as item(
    "weekStart" date, estimate numeric, actual numeric
  )
  on conflict (user_id, week_start) do update set estimate = excluded.estimate, actual = excluded.actual;

  delete from public.week_history existing
  where existing.user_id = current_user_id
    and not exists (
      select 1 from jsonb_to_recordset(coalesce(p_data -> 'weekHistory', '[]'::jsonb)) as item("weekStart" date)
      where item."weekStart" = existing.week_start
    );
end;
$$;

revoke all on function public.replace_user_data(jsonb) from public, anon;
grant execute on function public.replace_user_data(jsonb) to authenticated;
