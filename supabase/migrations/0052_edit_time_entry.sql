-- ============================================================================
-- 0050 · Let a manager correct a time entry
--
-- 0047 removed the ability for anyone to write to time_entries except
-- through record_clock_in/record_clock_out/record_toggle_break — correct,
-- since a bare update let any org member fabricate hours. But those three
-- functions only ever act "as of now": there was no way left for a manager
-- to fix a stuck-open shift (clock_out stuck at null for two days, say) or
-- correct a mistaken clock-in/out time after the fact. This adds exactly
-- that, manager+ only, with no other write path re-opened.
-- ============================================================================

create or replace function public.edit_time_entry(
  _org uuid,
  _entry uuid,
  _clock_in timestamptz,
  _clock_out timestamptz default null,
  _break_seconds integer default 0,
  _note text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_org_role(_org, 'owner', 'admin', 'manager') then
    raise exception 'manager access required to edit a time entry';
  end if;
  if _clock_in is null then raise exception 'clock-in time is required'; end if;
  if _clock_out is not null and _clock_out <= _clock_in then
    raise exception 'clock-out must be after clock-in';
  end if;
  if coalesce(_break_seconds, 0) < 0 then raise exception 'break time cannot be negative'; end if;

  update time_entries set
    clock_in = _clock_in,
    clock_out = _clock_out,
    break_seconds = coalesce(_break_seconds, 0),
    -- A manual edit always fully resolves the entry — leaving a running
    -- break in place would let workedSeconds() keep counting down live on a
    -- shift a manager just believed they'd closed.
    break_started_at = null,
    note = coalesce(_note, note)
  where id = _entry and org_id = _org;

  if not found then raise exception 'time entry not found'; end if;
end $$;

grant execute on function public.edit_time_entry(uuid, uuid, timestamptz, timestamptz, integer, text) to authenticated;
