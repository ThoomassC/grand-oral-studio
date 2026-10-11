import { redirect } from "next/navigation";
import { HomeLanding } from "@/components/home/HomeLanding";
import { getUser } from "@/server/session";

export default async function HomePage() {
  const user = await getUser();
  if (user) redirect("/projets");

  return <HomeLanding />;
}
