"use client";

import { RequireModule } from "@/components/guards";
import MenuEngineering from "@/views/MenuEngineering";

export default function Page() {
  return (
    <RequireModule id="menu">
      <MenuEngineering />
    </RequireModule>
  );
}
