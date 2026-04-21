import type { LoaderFunction } from "@remix-run/node";
import { json } from "@remix-run/node";

export const loader: LoaderFunction = async ({ params }) => {
  const id = params.id;
  if (!id) {
    return json({ error: "Missing id" }, { status: 400 });
  }
  try {
    const res = await fetch(
      `http://localhost:3001/api/requests/${encodeURIComponent(id)}`,
    );
    if (!res.ok) {
      return json(
        { error: `Backend returned ${res.status}` },
        { status: res.status },
      );
    }
    const data = await res.json();
    return json(data);
  } catch (err) {
    console.error("Failed to fetch request detail:", err);
    return json({ error: "Failed to fetch request detail" }, { status: 500 });
  }
};
