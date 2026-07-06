-- deliveries.courier_employee_id has never had a foreign key, despite
-- clearly referencing employees(id) everywhere it's used in the app. This
-- surfaced while wiring the mobile manager delivery view: PostgREST's
-- embedded-select join syntax (`deliveries?select=*,employees(name)`)
-- requires a real FK to auto-detect the relationship — without one it fails
-- with a schema-cache "no relationship found" error.
--
-- `on delete set null` matches how `courier_employee_id` is already treated
-- elsewhere (nullable, reassignable) — removing an employee shouldn't
-- silently break/cascade-delete their past delivery history.
alter table public.deliveries
  add constraint deliveries_courier_employee_id_fkey
  foreign key (courier_employee_id) references public.employees(id) on delete set null;
