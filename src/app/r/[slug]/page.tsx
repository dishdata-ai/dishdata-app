import type { Metadata } from "next";
import Storefront from "@/views/Storefront";
import { fetchPublicMenuServer } from "@/lib/api/public-server";

type Params = Promise<{ slug: string }>;
type Search = Promise<{ table?: string; order?: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const menu = await fetchPublicMenuServer(slug);
  if (!menu) return { title: "Menu — DishData" };
  return {
    title: `${menu.org.name} — Menu & Online Ordering`,
    description: `Order online from ${menu.org.name}. Browse the menu and book a table.`,
    openGraph: {
      title: `${menu.org.name} — Menu & Online Ordering`,
      images: menu.org.logo_url ? [{ url: menu.org.logo_url }] : undefined,
    },
  };
}

export default async function StorefrontPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}) {
  const { slug } = await params;
  const { table, order } = await searchParams;
  const initialMenu = await fetchPublicMenuServer(slug);
  const orderType = order === "takeaway" ? "takeaway" : "dine_in";
  return <Storefront slug={slug} tableName={orderType === "takeaway" ? null : (table ?? null)} orderType={orderType} initialMenu={initialMenu} />;
}
