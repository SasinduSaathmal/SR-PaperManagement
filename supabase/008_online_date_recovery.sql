-- Run after 007_zero_fill_empty_batches.sql. Does not change marks on its own.
-- Recovery requires a fresh file, a checked interpretation, and an active admin.
begin;
create table if not exists public.online_file_import_receipts (
 test_id uuid not null references public.marks_tests(id), rows_hash text not null,
 filename text not null, result jsonb not null, created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(), primary key(test_id,rows_hash)
);
alter table public.online_file_import_receipts enable row level security;
revoke all on public.online_file_import_receipts from public,anon,authenticated;
create or replace function app_private.online_import_code(p_code text,p_year integer)
returns text language plpgsql immutable set search_path = '' as $$
declare code text:=upper(btrim(coalesce(p_code,''))); parts text[];
begin
 if char_length(code)>100 then return null; end if;
 if code ~ '^[0-9]+$' then return 'SC/'||p_year||'/'||coalesce(nullif(ltrim(code,'0'),''),'0'); end if;
 parts:=regexp_match(code,'^SC/([0-9]{4})/([0-9]+)$');
 if parts is null or parts[1]::integer<>p_year then return null; end if;
 return 'SC/'||p_year||'/'||coalesce(nullif(ltrim(parts[2],'0'),''),'0');
end; $$;

create or replace function public.app_import_online_file(p_test_id uuid,p_filename text,p_heading text,p_rows jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.marks_tests%rowtype; g public.exam_groups%rowtype; item jsonb; conversion jsonb; old_row public.online_import_rows%rowtype;
 payload jsonb; result jsonb; remaining jsonb:='[]'; code text; covered boolean; recovered integer:=0; parts text[];
 maximum integer; month_number integer; year_number integer; recoverable boolean; file_hash text;
begin
 if not app_private.is_admin() then raise exception 'Only active admins can import online marks.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 payload:=jsonb_build_array('import file with date recovery',p_test_id,p_filename,p_heading,p_rows);
 result:=app_private.marks_receipt(p_request_id,payload); if result is not null then return result; end if;
 t:=app_private.lock_marks_test(p_test_id);
 if t.id is null or t.status<>'Open' then raise exception 'Online marks can only be imported into an open test.'; end if;
 select * into g from public.exam_groups where id=t.group_id;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' then raise exception 'Choose student rows to import.'; end if;
 if jsonb_array_length(p_rows) not between 1 and 1000 then raise exception 'Import 1 to 1000 rows at a time.'; end if;
 if char_length(coalesce(p_filename,'')) not between 1 and 255 or char_length(coalesce(p_heading,''))>500 then raise exception 'Invalid filename or heading.'; end if;
 parts:=regexp_match(p_heading,'(?i)\m(20[0-9]{2})\M');
 if parts is not null and parts[1]::integer<>g.exam_year then raise exception 'Export year differs from this group.'; end if;
 parts:=regexp_match(p_heading,'(?i)paper\s*0*([0-9]+)');
 if parts is not null and parts[1]::integer<>t.paper then raise exception 'Export paper differs from this test.'; end if;
 parts:=regexp_match(p_heading,'(?i)phase\s*([0-9]+)');
 if parts is not null and regexp_replace(lower(t.phase),'^phase\s*','') ~ '^[0-9]+$' and parts[1]::integer<>regexp_replace(lower(t.phase),'^phase\s*','')::integer then raise exception 'Export phase differs from this test.'; end if;
 file_hash:=md5(p_rows::text);
 select r.result into result from public.online_file_import_receipts r where r.test_id=t.id and r.rows_hash=file_hash;
 if found then
   insert into public.marks_write_requests values(p_request_id,auth.uid(),payload,result,now()); return result;
 end if;
 for item in select value from jsonb_array_elements(p_rows) loop
   if jsonb_typeof(item)<>'object' or octet_length(item::text)>10000 then raise exception 'Invalid import row.'; end if;
   conversion:=item->'mark_conversion'; covered:=false; recoverable:=false;
   if conversion is not null and conversion<>'null'::jsonb then
     maximum:=(conversion->>'maximum')::integer; month_number:=(conversion->>'month')::integer; year_number:=(conversion->>'year')::integer;
     if coalesce(conversion->>'confirmed','false')<>'true' or coalesce(conversion->>'kind','') not in ('excel-date','text-month-year')
       or maximum is null or maximum not between 32 and 99 or maximum*100<>t.max_cents
       or month_number is null or month_number not between 1 and 12 or year_number is null or year_number not between 1900 and 2099 or year_number%100<>maximum
       or coalesce(conversion->>'day','')<>'1' or coalesce(conversion->>'format','') !~* '^m{3,4}[-/ ]y{2,4}$'
       or coalesce(item->>'mark','')<>month_number||' / '||maximum or nullif(item->>'mark_original','') is null then
       raise exception 'Date recovery must be explicitly confirmed and match this test maximum and a month/year conversion.';
     end if;
     recoverable:=true;
   elsif coalesce(item->>'mark','') ~ '^[0-9]{1,7}(\.[0-9]{1,2})?(\s*/\s*[0-9]{1,7}(\.[0-9]{1,2})?)?$' then
     recoverable:=btrim(split_part(item->>'mark','/',1))::numeric*100 between 1 and t.max_cents;
     if position('/' in (item->>'mark'))>0 and btrim(split_part(item->>'mark','/',2))::numeric*100<>t.max_cents then recoverable:=false; end if;
   end if;
   if recoverable then
     code:=app_private.online_import_code(item->>'code',g.exam_year);
     if code is not null then
       if (select count(*) from jsonb_array_elements(p_rows) x where app_private.online_import_code(x->>'code',g.exam_year)=code)>1 then raise exception 'Resolve duplicate student IDs in the file before recovering converted dates.'; end if;
       for old_row in select * from public.online_import_rows r where r.test_id=t.id and r.status='Pending'
         and app_private.online_import_code(r.raw->>'code',g.exam_year)=code
         and (coalesce(r.raw->>'mark','') like '[Unsupported cell:%' or coalesce(r.raw->>'mark','') like '[Excel date:%'
           or coalesce(r.raw->>'mark','') ~* '^[a-z]{3}[- /][0-9]{2,4}$' or r.raw->'mark_conversion' is not null or r.raw->'mark_recovery' is not null)
         for update loop
         covered:=true;
         if old_row.raw->>'mark'=item->>'mark' and (old_row.raw->'mark_conversion' is not null or old_row.raw->'mark_recovery' is not null) then continue; end if;
         update public.online_import_rows set raw=raw||jsonb_build_object('mark',item->>'mark','mark_original',item->>'mark_original',
           'mark_conversion',conversion,'mark_recovery',jsonb_build_object('source_file',p_filename,'confirmed_by',auth.uid()),'previous_mark',old_row.raw->>'mark','recovery_source_file',p_filename)
           where id=old_row.id;
         insert into public.test_mark_history(test_id,actor_id,action,import_row_id)
           values(t.id,auth.uid(),'Recovered online score from source file '||p_filename,old_row.id);
         perform app_private.apply_online_row(old_row.id,'{}',false,null,null);
         recovered:=recovered+1;
       end loop;
     end if;
   end if;
   if not covered then remaining:=remaining||jsonb_build_array(item); end if;
 end loop;
 if jsonb_array_length(remaining)>0 then
   result:=public.app_stage_online_import(t.id,p_filename,p_heading,remaining,gen_random_uuid());
 else result:=jsonb_build_object('batch_id',null); end if;
 if recovered>0 then update public.marks_tests set revision=revision+1 where id=t.id; end if;
 result:=result||jsonb_build_object('recovered_pending',recovered);
 insert into public.online_file_import_receipts(test_id,rows_hash,filename,result,created_by) values(t.id,file_hash,p_filename,result,auth.uid());
 insert into public.marks_write_requests values(p_request_id,auth.uid(),payload,result,now()); return result;
end; $$;
revoke all on function app_private.online_import_code(text,integer) from public,anon,authenticated;
revoke all on function public.app_import_online_file(uuid,text,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.app_import_online_file(uuid,text,text,jsonb,uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
