"use client";

import { signOut } from "next-auth/react";
import Icon from "./Icon";

export default function SignOutButton() {
  return <button onClick={() => void signOut({ callbackUrl: "/sign-in" })} className="icon-button" aria-label="Sign out" title="Sign out"><Icon name="logout" /></button>;
}
