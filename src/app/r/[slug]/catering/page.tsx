import type { Metadata } from "next";
import Catering from "@/views/Catering";
import { fetchPublicMenuServer } from "@/lib/api/public-server";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const menu = await fetchPublicMenuServer(slug);
  if (!menu) return { title: "Catering — DishData" };
  return {
    title: `${menu.org.name} — Catering`,
    description: `Browse the full menu and request catering for your next event at ${menu.org.name}.`,
    openGraph: {
      title: `${menu.org.name} — Catering`,
      images: menu.org.logo_url ? [{ url: menu.org.logo_url }] : undefined,
    },
  };
}

export default async function CateringPage({ params }: { params: Params }) {
  const { slug } = await params;
  const initialMenu = await fetchPublicMenuServer(slug);
  return <Catering slug={slug} initialMenu={initialMenu} />;
}
