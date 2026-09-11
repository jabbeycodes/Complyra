import { useState } from "react";
import type { CreateAgencyResult } from "../data/types";
import LoginScreen from "./LoginScreen";
import SetupAgencyScreen from "./SetupAgencyScreen";

export default function AuthEntry() {
  const [mode, setMode] = useState<"signin" | "setup">("signin");
  const [prefill, setPrefill] = useState<CreateAgencyResult | null>(null);

  if (mode === "setup") {
    return (
      <SetupAgencyScreen
        onBack={() => setMode("signin")}
        onCreated={(result) => {
          setPrefill(result);
          setMode("signin");
        }}
      />
    );
  }

  return (
    <LoginScreen
      prefill={prefill}
      onSetup={() => setMode("setup")}
    />
  );
}
