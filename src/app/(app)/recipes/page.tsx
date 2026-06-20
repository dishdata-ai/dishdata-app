"use client";

import { RequireModule } from "@/components/guards";
import Recipes from "@/views/Recipes";

export default function Page() {
  return (
    <RequireModule id="recipes">
      <Recipes />
    </RequireModule>
  );
}
