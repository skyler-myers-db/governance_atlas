import { QueryClient } from "@tanstack/react-query";

export function createGovhubQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        gcTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

export const govhubQueryClient = createGovhubQueryClient();
