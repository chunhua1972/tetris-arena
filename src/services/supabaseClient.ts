import { createClient, type SupabaseClient } from "@supabase/supabase-js";
export const cloudUrl = (import.meta.env.VITE_SUPABASE_URL ?? "").trim();
export const cloudKey = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? ""
).trim();
let configurationError = "";
let client: SupabaseClient | null = null;
if (cloudUrl || cloudKey) {
  try {
    const url = new URL(cloudUrl);
    if (
      !cloudKey ||
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(url.hostname)
        ))
    )
      throw new Error("invalid configuration");
    if (cloudKey.startsWith("sb_secret_")) throw new Error("secret key");
    // Legacy JWT service_role keys must also never be bundled.
    if (cloudKey.startsWith("eyJ")) {
      const payload = JSON.parse(
        atob(cloudKey.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
      ) as { role?: string };
      if (payload.role !== "anon") throw new Error("non-public key");
    }
    client = createClient(cloudUrl, cloudKey);
  } catch {
    configurationError = "雲端連線設定無效，請檢查公開金鑰與網址。";
  }
}
export const supabase = client;
export const cloudError = configurationError;
export async function ensureUser() {
  if (!supabase) throw new Error(cloudError || "線上房間尚未啟用。");
  const current = await supabase.auth.getSession();
  if (current.error) throw current.error;
  if (current.data.session) return current.data.session.user;
  const result = await supabase.auth.signInAnonymously();
  if (result.error)
    throw new Error("無法登入，請確認 Supabase 已啟用匿名登入。");
  if (!result.data.user) throw new Error("登入未完成");
  return result.data.user;
}
export async function rpc<T>(
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  if (!supabase) throw new Error(cloudError || "線上房間尚未啟用。");
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  if (data && typeof data === "object" && "error" in data)
    throw new Error(String(data.error));
  return data as T;
}
