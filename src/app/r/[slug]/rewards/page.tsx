import type { Metadata } from "next";
import Rewards from "@/views/Rewards";
import { fetchPublicMenuServer } from "@/lib/api/public-server";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const menu = await fetchPublicMenuServer(slug);
  if (!menu) return { title: "Rewards — DishData" };
  return {
    title: `${menu.org.name} — Rewards`,
    description: `Check your points, earn more, and redeem rewards at ${menu.org.name}.`,
    openGraph: {
      title: `${menu.org.name} — Rewards`,
      images: menu.org.logo_url ? [{ url: menu.org.logo_url }] : undefined,
    },
  };
}

export default async function RewardsPage({ params }: { params: Params }) {
  const { slug } = await params;
  const initialMenu = await fetchPublicMenuServer(slug);
  return <Rewards slug={slug} initialMenu={initialMenu} />;
}
