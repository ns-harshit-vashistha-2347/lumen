"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { AuthShell } from "@/components/auth/auth-shell";
import { GoogleButton } from "@/components/auth/google-button";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { authApi } from "@/lib/auth";
import { ApiError } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const normEmail = email.trim().toLowerCase();
    if (!normEmail || !password) {
      toast.error("Email and password are required");
      return;
    }
    setLoading(true);
    try {
      await authApi.login(normEmail, password);
      router.push("/chat");
    } catch (err) {
      const msg = err instanceof ApiError ? err.detail : "Login failed";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      mode="login"
      title="Welcome back"
      subtitle="sign in to continue your session"
      footer={
        <>
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="text-prompt hover:text-prompt-glow underline underline-offset-4 decoration-prompt/40">
            sign up
          </Link>
        </>
      }
    >
      <GoogleButton label="Continue with Google" />

      <div className="my-5 flex items-center gap-3 font-mono text-[10.5px] uppercase tracking-[0.2em] text-ink-faint">
        <div className="h-px flex-1 bg-chrome-border" />
        <span>or</span>
        <div className="h-px flex-1 bg-chrome-border" />
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <Button type="submit" loading={loading} className="w-full" size="lg">
          SIGN IN <span className="text-[9px] opacity-70">↵</span>
        </Button>
      </form>
    </AuthShell>
  );
}
