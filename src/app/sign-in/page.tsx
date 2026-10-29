import { safeRelativePath } from "@/lib/redirect";
import { mockOAuthEnabled } from "@/server/mock-oauth";
import SignInForm from "./SignInForm";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string; error?: string }> }) {
  const params = await searchParams;
  return <SignInForm authError={params.error} callbackUrl={safeRelativePath(params.callbackUrl)} mockEnabled={mockOAuthEnabled()} />;
}
