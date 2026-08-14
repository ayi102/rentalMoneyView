"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient, supabaseConfig } from "@/lib/supabase/server";

export interface LoginState {
  error?: string;
}

/**
 * Sign in with email + password.
 *
 * There is deliberately no sign-up action: the single user account is created in
 * the Supabase dashboard, and public sign-ups are disabled there. An app holding
 * one person's financial records has no reason to accept new registrations.
 *
 * Rate limiting is handled by Supabase Auth's own per-IP sign-in limits rather
 * than a counter here, which wouldn't survive serverless cold starts anyway.
 */
export async function login(
  _prev: LoginState | undefined,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  // Distinguish "not set up yet" from "wrong credentials" — otherwise a missing
  // env var looks exactly like a bad password, which is a miserable thing to debug.
  if (!supabaseConfig()) {
    return {
      error:
        "This deployment isn't configured yet: the Supabase environment variables are missing. See DEPLOY.md.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // One generic message for every failure mode, so this can't be used to
    // discover whether an address has an account.
    return { error: "Incorrect email or password." };
  }

  // The whole app is behind auth, so drop any cached render from before login.
  revalidatePath("/", "layout");
  redirect("/");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
