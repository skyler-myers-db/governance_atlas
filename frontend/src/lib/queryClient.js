import { QueryClient } from "@tanstack/react-query";

export function createGovhubQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 15 * 60 * 1000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

export const govhubQueryClient = createGovhubQueryClient();
