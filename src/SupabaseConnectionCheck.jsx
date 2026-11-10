import React, { useState } from "react";

export default function SupabaseConnectionCheck() {
  const [message, setMessage] = useState("Not tested yet");
  const [checking, setChecking] = useState(false);

  async function checkConnection() {
    setChecking(true);
    setMessage("Checking...");

    try {
      const url = import.meta.env.VITE_SUPABASE_URL;
      const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      if (!url || !key) {
        throw new Error("Missing Supabase settings in .env.local");
      }

      const response = await fetch(`${url}/auth/v1/settings`, {
        headers: { apikey: key }
      });

      if (!response.ok) {
        throw new Error(`Supabase returned HTTP ${response.status}`);
      }

      setMessage("Connection successful!");
    } catch (error) {
      setMessage(`Connection failed: ${error.message}`);
    } finally {
      setChecking(false);
    }
  }

  return (
    <section>
      <button onClick={checkConnection} disabled={checking}>
        Test Supabase connection
      </button>
      <p>{message}</p>
    </section>
  );
}