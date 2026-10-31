"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Me } from "@/lib/types";

export const meQueryKey = ["me"] as const;

export function useMe() {
  return useQuery({ queryKey: meQueryKey, queryFn: () => api<Me>("/me"), staleTime: 30_000 });
}

/** UI hint only: the API enforces every permission server-side. */
export function useCan() {
  const { data } = useMe();
  return (resource: string, action: string) =>
    Boolean(data?.activeOrganization?.permissions[resource]?.includes(action));
}
