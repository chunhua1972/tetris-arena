-- Required in Supabase. A missing pg_cron extension must fail deployment visibly.
create extension if not exists pg_cron;
select cron.schedule('tetris-timeout-sweeper','5 seconds','select public.tetris_sweep();');
select cron.schedule('tetris-cron-log-cleanup','10 3 * * *',
  $$delete from cron.job_run_details where jobid in (select jobid from cron.job where jobname like 'tetris-%') and end_time<now()-interval '7 days'$$);
