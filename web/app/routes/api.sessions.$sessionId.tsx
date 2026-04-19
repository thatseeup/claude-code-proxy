import type { ActionFunction } from "@remix-run/node";
import { json } from "@remix-run/node";

export const action: ActionFunction = async ({ request, params }) => {
  if (request.method !== "DELETE") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const sessionIdToken = params.sessionId ?? "";
  if (sessionIdToken === "") {
    return json({ error: "Missing sessionId" }, { status: 400 });
  }

  try {
    const backendUrl = `http://localhost:3001/api/sessions/${encodeURIComponent(
      sessionIdToken
    )}`;
    const response = await fetch(backendUrl, { method: "DELETE" });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return json(data);
  } catch (error) {
    console.error("Failed to delete session:", error);
    return json(
      { success: false, error: "Failed to delete session" },
      { status: 500 }
    );
  }
};
