import { AlertCircle, Eye, EyeOff, Lock, LogIn, User } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandLogo } from "@/components/ui/primitives";
import { signInFn } from "@/server/functions/admin-auth.functions";

export function AdminSignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await signInFn({ data: { username, password } });
      if (result.ok) {
        setPassword("");
        onSignedIn();
      } else {
        setError(result.error);
      }
    } catch {
      setError("Sign-in failed. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-admin-canvas px-4 py-10 text-foreground">
      <Card className="w-full max-w-sm shadow-sm">
        <CardHeader className="gap-3 border-b border-border pb-4">
          <div className="flex items-center justify-between">
            <BrandLogo />
            <span className="rounded-sm bg-muted px-2 py-0.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              Admin
            </span>
          </div>
          <div>
            <CardTitle className="text-xl font-bold tracking-tight">Admin sign-in</CardTitle>
            <CardDescription className="mt-1">For the shop owner and staff. Sessions last eight hours.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="pt-2">
          {/* method="post": if someone submits before hydration, the password goes in a body, never the URL. */}
          <form className="grid gap-4" method="post" onSubmit={submit} noValidate>
            <div className="grid gap-2">
              <Label htmlFor="admin-username">Username</Label>
              <div className="relative">
                <User
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  id="admin-username"
                  name="username"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  className="pl-8.5"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="admin-password">Password</Label>
              <div className="relative">
                <Lock
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  id="admin-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  className="pr-9 pl-8.5"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((value) => !value)}
                >
                  {showPassword ? <EyeOff /> : <Eye />}
                </Button>
              </div>
            </div>
            {error ? (
              <Alert variant="destructive" role="alert">
                <AlertCircle />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <Button type="submit" size="lg" disabled={pending || !username || !password}>
              <LogIn />
              {pending ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
