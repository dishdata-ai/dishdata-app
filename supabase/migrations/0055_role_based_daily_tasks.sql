-- ============================================================================
-- 0055 · Role-based daily task assignments
--
-- Extends tasks table to support:
-- - assigned_role: which staff role this task targets (frontend, kitchen_lead, commi_kitchen)
-- - is_daily: whether this task repeats daily
-- - department: grouping for organization (front_of_house, kitchen, etc)
--
-- Allows creating daily recurring checklists for different positions, auto-assigned
-- to staff members based on their assigned role.
-- ============================================================================

alter table public.tasks
  add column assigned_role text,
  add column is_daily boolean not null default false,
  add column department text;

-- Enum for staff roles
create type public.staff_role as enum ('frontend', 'kitchen_lead', 'commi_kitchen', 'owner', 'admin', 'manager');

-- Enum for departments
create type public.department as enum ('front_of_house', 'kitchen', 'management');

-- Add constraints
alter table public.tasks
  alter column assigned_role type public.staff_role using assigned_role::public.staff_role,
  alter column department type public.department using department::public.department;

-- Index for faster role-based task lookups
create index idx_tasks_assigned_role on public.tasks(org_id, assigned_role) where assigned_role is not null;
create index idx_tasks_is_daily on public.tasks(org_id, is_daily) where is_daily = true;

-- RLS: tasks with assigned_role are visible to staff with that role
-- (existing task visibility rules still apply)

comment on column public.tasks.assigned_role is 'Staff role this task is assigned to (frontend, kitchen_lead, commi_kitchen)';
comment on column public.tasks.is_daily is 'Whether this is a daily recurring task';
comment on column public.tasks.department is 'Department grouping (front_of_house, kitchen, management)';
