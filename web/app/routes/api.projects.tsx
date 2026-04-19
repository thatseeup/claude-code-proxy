import type { LoaderFunction } from "@remix-run/node";
import { json } from "@remix-run/node";

export const loader: LoaderFunction = async () => {
  try {
    const response = await fetch("http://localhost:3001/api/projects");

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return json(data);
  } catch (error) {
    console.error("Failed to fetch projects:", error);
    return json([]);
  }
};
