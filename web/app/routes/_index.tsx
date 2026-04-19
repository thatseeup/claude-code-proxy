import { redirect } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";

export const loader = async (_args: LoaderFunctionArgs) => {
  return redirect("/requests");
};

export default function Index() {
  return null;
}
