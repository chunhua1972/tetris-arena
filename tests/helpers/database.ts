import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
export async function createDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create schema realtime; create table realtime.messages(id uuid default gen_random_uuid(),extension text,topic text,payload jsonb);
    alter table realtime.messages enable row level security;
    grant usage on schema auth,realtime to anon,authenticated,service_role;
    grant select,insert on realtime.messages to authenticated;
    create function realtime.topic() returns text language sql stable as $$select current_setting('request.realtime.topic',true)$$;
    create function realtime.send(payload jsonb,event text,topic text,is_private boolean) returns void language sql as $$insert into realtime.messages(extension,topic,payload) values('broadcast',topic,payload)$$;
  `);
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/202610030001_tetris_core.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  return db;
}
export async function queryAs<T>(
  db: PGlite,
  user: string | null,
  sql: string,
  params: unknown[] = [],
  role = user ? "authenticated" : "anon",
) {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
      user ?? "",
    ]);
    return tx.query<T>(sql, params);
  });
}
export async function call<T>(
  db: PGlite,
  user: string,
  name: string,
  args: Record<string, unknown>,
) {
  if (
    !/^tetris_[a-z_]+$/.test(name) ||
    Object.keys(args).some((k) => !/^p_[a-z_]+$/.test(k))
  )
    throw new Error("invalid test RPC");
  const entries = Object.entries(args);
  const result = await queryAs<{ value: T }>(
    db,
    user,
    `select public.${name}(${entries.map(([key], i) => `${key}=>$${i + 1}`).join(",")}) as value`,
    entries.map(([, value]) => value),
  );
  return result.rows[0].value;
}
