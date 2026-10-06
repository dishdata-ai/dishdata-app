-- Kokoland staff schedule, Tue 6 Oct – Sun 11 Oct 2026 (from the rota image).
-- "Close" is entered as 23:00, the same end time the Schedule board uses for its Dinner / Full day presets.
-- Safe to run twice: each person has one shift per day, so a re-run updates instead of duplicating.
-- Stops with a clear message if a name doesn't match exactly one staff record, rather than skipping anyone.

do $$
declare
  _org uuid;
  r record;
  _emp uuid;
  _n int;
begin
  select id into _org from public.orgs where slug = 'kokoland-berlin';
  if _org is null then raise exception 'Org kokoland-berlin not found'; end if;

  for r in
    select * from (values
      ('Ajin',    '2026-10-06'::date, '17:00'::time, '23:00'::time),
      ('Sagar',   '2026-10-06',       '19:00',       '23:00'),
      ('Joyal',   '2026-10-07',       '17:00',       '23:00'),
      ('Rafnas',  '2026-10-07',       '19:00',       '23:00'),
      ('Sagar',   '2026-10-08',       '17:00',       '23:00'),
      ('Joyal',   '2026-10-08',       '19:00',       '23:00'),
      ('Ajin',    '2026-10-09',       '17:00',       '23:00'),
      ('Alfred',  '2026-10-09',       '17:00',       '23:00'),
      ('Emil',    '2026-10-09',       '11:00',       '17:00'),
      ('Ajin',    '2026-10-10',       '17:00',       '23:00'),
      ('Emil',    '2026-10-10',       '11:00',       '17:00'),
      ('Gabriel', '2026-10-10',       '17:00',       '23:00'),
      ('Ajin',    '2026-10-11',       '17:00',       '23:00'),
      ('Emil',    '2026-10-11',       '17:00',       '23:00'),
      ('Gabriel', '2026-10-11',       '11:00',       '17:00')
    ) as t(who, day, start_time, end_time)
  loop
    select count(*), min(id::text)::uuid into _n, _emp
      from public.employees where org_id = _org and name ilike r.who || '%';
    if _n <> 1 then
      raise exception 'Expected exactly one staff record matching "%", found %', r.who, _n;
    end if;

    insert into public.shifts (org_id, employee_id, day, start_time, end_time)
    values (_org, _emp, r.day, r.start_time, r.end_time)
    on conflict (employee_id, day)
    do update set start_time = excluded.start_time, end_time = excluded.end_time, updated_at = now();
  end loop;
end $$;

-- Check: should list 15 rows.
select e.name, s.day, s.start_time, s.end_time
from public.shifts s join public.employees e on e.id = s.employee_id
where s.day between '2026-10-06' and '2026-10-11'
order by s.day, s.start_time, e.name;
