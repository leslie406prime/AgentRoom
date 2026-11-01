export function signInErrorMessage(error?: string): string | undefined {
  if (!error) return undefined;
  if (error === "OAuthAccountNotLinked") return "This Google account cannot be connected. Please continue with the Google account you used before. Accounts are never merged by email address.";
  if (error === "LinkRequired") return "To connect a Google account, start from your account settings while signed in.";
  if (error === "AccessDenied") return "Sign in was refused. Please try again with the Google account you used before.";
  return "Google sign-in could not be completed. Please try again. If this continues, contact the application administrator.";
}
