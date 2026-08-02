-- CV es opcional: no cuenta en alertas de docs obligatorios de plantilla.
-- IDEMPOTENTE. Supabase → SQL Editor → Run.

update public.hr_employee_documents
set
  required = false,
  notes = coalesce(nullif(trim(notes), ''), 'Curriculum vitae · opcional'),
  updated_at = now()
where doc_type = 'cv'
  and required = true;
