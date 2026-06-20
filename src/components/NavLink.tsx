"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MouseEventHandler, ReactNode } from "react";

type ActiveState = { isActive: boolean };
type RenderProp = (state: ActiveState) => ReactNode;

/** next/link wrapper that mirrors the subset of react-router's NavLink API we use:
 *  function-or-string className and function-or-node children, both fed `isActive`. */
export default function NavLink({
  to,
  className,
  children,
  onClick,
  ...rest
}: {
  to: string;
  className?: string | ((state: ActiveState) => string);
  children?: ReactNode | RenderProp;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
} & Record<string, unknown>) {
  const pathname = usePathname() ?? "";
  const isActive =
    to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(to + "/");
  const cls = typeof className === "function" ? className({ isActive }) : className;
  return (
    <Link href={to} className={cls} onClick={onClick} {...rest}>
      {typeof children === "function" ? (children as RenderProp)({ isActive }) : children}
    </Link>
  );
}
